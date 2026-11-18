const { sendResponse, schemas, z } = require('@zafabit/service-kit');
const upstream = require('../utils/upstream');
const { relay } = require('../utils/relay');

// SOS incidents for the admin Support dashboard. support-trust owns the data;
// this adds names from identity-profiles and shapes each row for the panel.

const listQuerySchema = z.object({
  status: schemas.oneOf(['active', 'resolved'], 'Status').optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const idParamSchema = z.object({ id: schemas.uuid });

const nameOf = (profile) =>
  profile ? profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null : null;

// Stored as "lat,lng" by the SOS endpoint; shown as "lat, lng".
const formatLocation = (raw) => {
  if (!raw) return null;
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(String(raw).trim());
  return m ? `${m[1]}, ${m[2]}` : String(raw);
};

const namesFor = async (ids) => {
  const userIds = [...new Set(ids.filter(Boolean))];
  if (!userIds.length) return {};
  const result = await upstream.identity.post('/internal/admin/profiles/batch', { userIds });
  return result.ok && result.data ? result.data.profiles || {} : {};
};

const toPanel = (incident, names) => ({
  _id: incident._id,
  incidentId: incident.incidentId,
  user: nameOf(names[incident.userId]) || 'Unknown',
  userRole: incident.userRole,
  type: incident.type,
  location: formatLocation(incident.location),
  lastLocation: incident.lastLocation || null,
  description: incident.description || null,
  priority: incident.priority,
  status: incident.status,
  reporterPhone: incident.reporterPhone || null,
  resolvedBy: nameOf(names[incident.resolvedByUserId]),
  createdAt: incident.createdAt,
});

const listIncidents = async (req, res, next) => {
  try {
    const result = await upstream.support.get('/internal/incidents', req.validated);
    if (!result.ok) return relay(res, result);
    const rows = (result.data && result.data.incidents) || [];
    const names = await namesFor(rows.flatMap((r) => [r.userId, r.resolvedByUserId]));
    return sendResponse(res, 200, 'SOS incidents.', { incidents: rows.map((r) => toPanel(r, names)) });
  } catch (error) {
    return next(error);
  }
};

const resolveIncident = async (req, res, next) => {
  try {
    const result = await upstream.support.patch(`/internal/incidents/${req.params.id}/resolve`, {
      resolvedByUserId: req.admin.id,
    });
    if (!result.ok) return relay(res, result);
    const row = result.data.incident;
    const names = await namesFor([row.userId, row.resolvedByUserId]);
    return sendResponse(res, 200, 'Incident resolved.', { incident: toPanel(row, names) });
  } catch (error) {
    return next(error);
  }
};

module.exports = { listQuerySchema, idParamSchema, toPanel, formatLocation, listIncidents, resolveIncident };
