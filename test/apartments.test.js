const mockAuth = { get: jest.fn() };
const mockCatalogue = { forward: jest.fn(), get: jest.fn() };
const mockMaid = { get: jest.fn(), put: jest.fn() };
const mockBooking = { get: jest.fn(), patch: jest.fn() };

jest.mock('../src/utils/upstream', () => {
  const actual = jest.requireActual('../src/utils/upstream');
  return {
    auth: mockAuth,
    identity: {},
    catalogue: mockCatalogue,
    maid: mockMaid,
    booking: mockBooking,
    UpstreamError: actual.UpstreamError,
  };
});

const request = require('supertest');
const { generateToken } = require('@zafabit/service-kit');
const app = require('../src/app');

const APT = '88888888-8888-8888-8888-888888888888';
const MAID = '55555555-5555-5555-5555-555555555555';
const BOOKING = '44444444-4444-4444-4444-444444444444';

let seq = 0;
const signIn = (adminRole) => {
  seq += 1;
  const id = `cccccccc-cccc-cccc-cccc-${String(seq).padStart(12, '0')}`;
  mockAuth.get.mockResolvedValue({ ok: true, status: 200, data: { id, role: 'admin', adminRole, isBlocked: false } });
  return `Bearer ${generateToken(id, 'admin')}`;
};
const ok = (data, meta = {}) => ({ ok: true, status: 200, message: 'OK', data, meta });

beforeEach(() => jest.resetAllMocks());

describe('/apartments', () => {
  it('lists apartments with tower and stationed-maid counts', async () => {
    const token = signIn('operations_admin');
    mockCatalogue.forward.mockResolvedValue(
      ok({ apartments: [{ id: APT, name: 'DLF', towers: ['1', '2'], status: 'live' }] }, { pagination: { page: 1 } }),
    );
    mockMaid.get.mockResolvedValue(ok({ counts: { [APT]: 3 } }));

    const res = await request(app).get('/apartments?status=live').set('authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.apartments[0]).toMatchObject({ towerCount: 2, maidsAssigned: 3 });
    expect(res.body.meta.pagination).toEqual({ page: 1 });
    expect(mockCatalogue.forward.mock.calls[0][0]).toBe('/internal/admin/apartments');
  });

  it('shows maid counts as unknown when maid-service is down', async () => {
    const token = signIn('super_admin');
    mockCatalogue.forward.mockResolvedValue(ok({ apartments: [{ id: APT, towers: [] }] }));
    mockMaid.get.mockRejectedValue(new Error('down'));
    const res = await request(app).get('/apartments').set('authorization', token);
    expect(res.body.data.apartments[0].maidsAssigned).toBeNull();
  });

  it('the switch is relayed to service-catalogue; finance admins cannot use it', async () => {
    mockCatalogue.forward.mockResolvedValue(ok({ apartment: { id: APT, status: 'paused' } }));
    const res = await request(app)
      .patch(`/apartments/${APT}/status`)
      .set('authorization', signIn('operations_admin'))
      .send({ status: 'paused', pausedUntil: '2026-10-25' });
    expect(res.status).toBe(200);
    expect(mockCatalogue.forward.mock.calls[0][0]).toBe(`/internal/admin/apartments/${APT}/status`);

    const denied = await request(app)
      .patch(`/apartments/${APT}/status`)
      .set('authorization', signIn('finance_admin'))
      .send({ status: 'live' });
    expect(denied.status).toBe(403);
  });

  it('open bookings come from booking-engine', async () => {
    mockBooking.get.mockResolvedValue(ok({ bookings: [] }));
    const res = await request(app).get(`/apartments/${APT}/open-bookings`).set('authorization', signIn('super_admin'));
    expect(res.status).toBe(200);
    expect(mockBooking.get).toHaveBeenCalledWith('/internal/bookings', { apartmentId: APT });
  });
});

describe('PUT /maids/:userId/apartment', () => {
  it('checks the apartment exists, then stations the maid', async () => {
    const token = signIn('operations_admin');
    mockCatalogue.get.mockResolvedValue(ok({ apartment: { id: APT } }));
    mockMaid.put.mockResolvedValue(ok({ userId: MAID, apartmentId: APT }));
    const res = await request(app).put(`/maids/${MAID}/apartment`).set('authorization', token).send({ apartmentId: APT });
    expect(res.status).toBe(200);
    expect(mockMaid.put).toHaveBeenCalledWith(`/internal/maids/${MAID}/apartment`, { apartmentId: APT });
  });

  it('refuses an unknown apartment without touching the maid', async () => {
    const token = signIn('operations_admin');
    mockCatalogue.get.mockResolvedValue({
      ok: false,
      status: 404,
      message: "We couldn't find that apartment.",
      error: { code: 'APARTMENT_NOT_FOUND' },
      data: null,
      meta: {},
    });
    const res = await request(app).put(`/maids/${MAID}/apartment`).set('authorization', token).send({ apartmentId: APT });
    expect(res.status).toBe(404);
    expect(mockMaid.put).not.toHaveBeenCalled();
  });

  it('unassigns with null', async () => {
    const token = signIn('operations_admin');
    mockMaid.put.mockResolvedValue(ok({ userId: MAID, apartmentId: null }));
    const res = await request(app).put(`/maids/${MAID}/apartment`).set('authorization', token).send({ apartmentId: null });
    expect(res.status).toBe(200);
    expect(mockCatalogue.get).not.toHaveBeenCalled();
  });
});

describe('/operations/hr-queue', () => {
  it('lists the queue, the region candidates, and assigns directly', async () => {
    const token = signIn('operations_admin');
    mockBooking.get.mockResolvedValue(ok({ bookings: [{ _id: BOOKING }] }));
    expect((await request(app).get('/operations/hr-queue').set('authorization', token)).status).toBe(200);
    expect(mockBooking.get).toHaveBeenCalledWith('/internal/bookings/hr-queue');

    await request(app).get(`/operations/hr-queue/${BOOKING}/maids`).set('authorization', token);
    expect(mockBooking.get).toHaveBeenLastCalledWith(`/internal/bookings/${BOOKING}/candidates`);

    mockBooking.patch.mockResolvedValue(ok({ bookingId: BOOKING, status: 'accepted' }));
    const assigned = await request(app)
      .post(`/operations/hr-queue/${BOOKING}/assign`)
      .set('authorization', token)
      .send({ maidId: MAID });
    expect(assigned.status).toBe(200);
    expect(mockBooking.patch).toHaveBeenCalledWith(`/internal/bookings/${BOOKING}/assign`, { maidId: MAID, direct: true });
  });

  it('needs a valid maid id and an operations role', async () => {
    const token = signIn('operations_admin');
    expect(
      (await request(app).post(`/operations/hr-queue/${BOOKING}/assign`).set('authorization', token).send({})).status,
    ).toBe(400);
    expect((await request(app).get('/operations/hr-queue').set('authorization', signIn('support_admin'))).status).toBe(403);
  });
});

describe('/zones and /apartment-requests', () => {
  it('relay to service-catalogue', async () => {
    mockCatalogue.forward.mockResolvedValue(ok({ zones: [] }));
    await request(app).get('/zones').set('authorization', signIn('super_admin'));
    expect(mockCatalogue.forward.mock.calls[0][0]).toBe('/internal/admin/zones');
    await request(app).get('/apartment-requests').set('authorization', signIn('support_admin'));
    expect(mockCatalogue.forward.mock.calls[1][0]).toBe('/internal/admin/apartment-requests');
  });
});
