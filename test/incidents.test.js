jest.mock('../src/utils/upstream', () => ({
  support: { get: jest.fn(), patch: jest.fn() },
  identity: { post: jest.fn() },
}));

const upstream = require('../src/utils/upstream');
const incidents = require('../src/controllers/incidentsController');

const USER = '5b4fbb1e-7d0c-4a5e-9c4d-1f2e3a4b5c6d';
const ADMIN = '11111111-2222-4333-8444-555555555555';

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const row = (over = {}) => ({
  _id: 'i1',
  incidentId: 'SOS-ABC-1234',
  userId: USER,
  userRole: 'maid',
  type: 'sos',
  location: '9.98,76.29',
  lastLocation: 'GPS at the press',
  description: 'SOS pressed',
  priority: 'critical',
  status: 'active',
  reporterPhone: null,
  resolvedByUserId: null,
  createdAt: '2026-11-18T10:00:00.000Z',
  ...over,
});

beforeEach(() => jest.clearAllMocks());

test('formatLocation turns "lat,lng" into "lat, lng" and passes other text through', () => {
  expect(incidents.formatLocation('9.98,76.29')).toBe('9.98, 76.29');
  expect(incidents.formatLocation('No GPS')).toBe('No GPS');
  expect(incidents.formatLocation(null)).toBeNull();
});

test('list adds names and shapes rows for the panel', async () => {
  upstream.support.get.mockResolvedValue({ ok: true, data: { incidents: [row()] } });
  upstream.identity.post.mockResolvedValue({
    ok: true,
    data: { profiles: { [USER]: { firstName: 'Priya', lastName: 'Nair' } } },
  });
  const res = mockRes();
  await incidents.listIncidents({ validated: { status: 'active', limit: 100 } }, res, jest.fn());
  const body = res.json.mock.calls[0][0];
  expect(upstream.support.get).toHaveBeenCalledWith('/internal/incidents', { status: 'active', limit: 100 });
  expect(body.data.incidents[0]).toMatchObject({
    _id: 'i1',
    user: 'Priya Nair',
    location: '9.98, 76.29',
    resolvedBy: null,
    status: 'active',
    priority: 'critical',
  });
});

test('unknown reporters show as Unknown', async () => {
  upstream.support.get.mockResolvedValue({ ok: true, data: { incidents: [row()] } });
  upstream.identity.post.mockResolvedValue({ ok: true, data: { profiles: {} } });
  const res = mockRes();
  await incidents.listIncidents({ validated: { limit: 100 } }, res, jest.fn());
  expect(res.json.mock.calls[0][0].data.incidents[0].user).toBe('Unknown');
});

test('resolve records the signed-in admin as the resolver', async () => {
  upstream.support.patch.mockResolvedValue({
    ok: true,
    data: { incident: row({ status: 'resolved', resolvedByUserId: ADMIN }) },
  });
  upstream.identity.post.mockResolvedValue({
    ok: true,
    data: { profiles: { [ADMIN]: { name: 'Support Desk' }, [USER]: { name: 'Priya' } } },
  });
  const res = mockRes();
  await incidents.resolveIncident({ params: { id: 'i1' }, admin: { id: ADMIN } }, res, jest.fn());
  expect(upstream.support.patch).toHaveBeenCalledWith('/internal/incidents/i1/resolve', { resolvedByUserId: ADMIN });
  const incident = res.json.mock.calls[0][0].data.incident;
  expect(incident.status).toBe('resolved');
  expect(incident.resolvedBy).toBe('Support Desk');
});
