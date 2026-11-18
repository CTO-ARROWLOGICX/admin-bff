const { sendResponse, schemas, z } = require('@zafabit/service-kit');
const upstream = require('../utils/upstream');
const { relay } = require('../utils/relay');

// Maid verification queue (Maid Partners page). Maid service owns the data;
// this adds each maid's name from identity-profiles for the panel.

const pendingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const verificationParamSchema = z.object({
  id: schemas.uuid,
});

const approveVerificationSchema = z.object({
  isIdentityVerified: z.boolean(),
  activeStatus: schemas.oneOf(['active', 'inactive', 'on-hold'], 'Status'),
  documentStatus: z
    .array(
      z.object({
        id: schemas.uuid,
        status: schemas.oneOf(['verified', 'rejected'], 'Document status'),
      }),
    )
    .default([]),
});

const displayName = (profile) => {
  if (!profile) return null;
  return profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null;
};

const listPending = async (req, res, next) => {
  try {
    const result = await upstream.maid.get('/internal/verifications/pending', req.query);
    if (!result.ok) return relay(res, result);

    const { maids = [], total = 0, page = 1, limit = 20 } = result.data || {};
    let profiles = {};
    if (maids.length) {
      const named = await upstream.identity.post('/internal/admin/profiles/batch', {
        userIds: maids.map((m) => m.userId),
      });
      profiles = named.ok && named.data ? named.data.profiles || {} : {};
    }

    return sendResponse(res, 200, 'Pending maid verifications.', {
      maids: maids.map((m) => ({
        ...m,
        user: { _id: m.userId, name: displayName(profiles[m.userId]) },
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    return next(error);
  }
};

const approveVerification = async (req, res, next) => {
  try {
    return relay(
      res,
      await upstream.maid.patch(`/internal/verifications/${req.params.id}/approve`, req.validated),
    );
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  pendingQuerySchema,
  verificationParamSchema,
  approveVerificationSchema,
  listPending,
  approveVerification,
};
