const mockAuth = { get: jest.fn() };
const mockCatalogue = { forward: jest.fn() };

jest.mock('../src/utils/upstream', () => {
  const actual = jest.requireActual('../src/utils/upstream');
  return { auth: mockAuth, identity: {}, catalogue: mockCatalogue, UpstreamError: actual.UpstreamError };
});

const request = require('supertest');
const { generateToken } = require('@zafabit/service-kit');
const app = require('../src/app');

const SERVICE_ID = '44444444-4444-4444-4444-444444444444';
let seq = 0;
const signIn = (adminRole) => {
  seq += 1;
  const id = `bbbbbbbb-bbbb-bbbb-bbbb-${String(seq).padStart(12, '0')}`;
  mockAuth.get.mockResolvedValue({
    ok: true,
    status: 200,
    data: { id, role: 'admin', adminRole, isBlocked: false },
  });
  return `Bearer ${generateToken(id, 'admin')}`;
};

beforeEach(() => jest.resetAllMocks());

describe('/shared/services', () => {
  it('lets any admin role list, relaying data + pagination', async () => {
    const token = signIn('marketing_admin');
    mockCatalogue.forward.mockResolvedValue({
      ok: true,
      status: 200,
      message: 'Services retrieved',
      data: { services: [{ _id: SERVICE_ID }] },
      meta: { pagination: { page: 1, totalItems: 1 }, requestId: 'upstream-id' },
    });
    const res = await request(app).get('/shared/services?all=true&limit=10').set('authorization', token);
    expect(res.status).toBe(200);
    expect(mockCatalogue.forward.mock.calls[0][0]).toBe('/internal/admin/services');
    expect(res.body.data.services[0]._id).toBe(SERVICE_ID);
    expect(res.body.meta.pagination).toEqual({ page: 1, totalItems: 1 });
    expect(res.body.meta.requestId).not.toBe('upstream-id'); // our own request id
  });

  it('relays service-catalogue errors (409) with their code', async () => {
    const token = signIn('super_admin');
    mockCatalogue.forward.mockResolvedValue({
      ok: false,
      status: 409,
      message: 'A service with that name already exists.',
      error: { code: 'SERVICE_NAME_TAKEN', details: [] },
      data: null,
      meta: {},
    });
    const res = await request(app).post('/shared/services').set('authorization', token).send({ name: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SERVICE_NAME_TAKEN');
  });

  it('forwards PUT/DELETE to the id path and rejects a junk id locally', async () => {
    const token = signIn('operations_admin');
    mockCatalogue.forward.mockResolvedValue({ ok: true, status: 200, message: 'ok', data: {}, meta: {} });
    await request(app).put(`/shared/services/${SERVICE_ID}`).set('authorization', token).send({ status: 'inactive' });
    expect(mockCatalogue.forward.mock.calls[0][0]).toBe(`/internal/admin/services/${SERVICE_ID}`);
    const bad = await request(app).delete('/shared/services/..%2F..%2Finternal').set('authorization', token);
    expect(bad.status).toBe(400);
    expect(mockCatalogue.forward).toHaveBeenCalledTimes(1);
  });
});

describe('/config/booking', () => {
  it('is super/operations only', async () => {
    const token = signIn('finance_admin');
    const res = await request(app).get('/config/booking').set('authorization', token);
    expect(res.status).toBe(403);
    expect(mockCatalogue.forward).not.toHaveBeenCalled();
  });

  it('relays the config object as data', async () => {
    const token = signIn('operations_admin');
    mockCatalogue.forward.mockResolvedValue({
      ok: true,
      status: 200,
      message: 'Booking configuration retrieved',
      data: { slots: ['08:00 AM'], platformFee: 29 },
      meta: {},
    });
    const res = await request(app).get('/config/booking').set('authorization', token);
    expect(res.status).toBe(200);
    expect(mockCatalogue.forward.mock.calls[0][0]).toBe('/internal/booking-config');
    expect(res.body.data).toEqual({ slots: ['08:00 AM'], platformFee: 29 });
  });
});
