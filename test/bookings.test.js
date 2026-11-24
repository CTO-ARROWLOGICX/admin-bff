const mockAuth = { get: jest.fn() };
const mockBooking = { get: jest.fn(), patch: jest.fn(), del: jest.fn() };

jest.mock('../src/utils/upstream', () => {
  const actual = jest.requireActual('../src/utils/upstream');
  return { auth: mockAuth, identity: {}, catalogue: {}, maid: {}, booking: mockBooking, UpstreamError: actual.UpstreamError };
});

const request = require('supertest');
const { generateToken } = require('@zafabit/service-kit');
const app = require('../src/app');

let seq = 0;
const signIn = (adminRole) => {
  seq += 1;
  const id = `dddddddd-dddd-dddd-dddd-${String(seq).padStart(12, '0')}`;
  mockAuth.get.mockResolvedValue({ ok: true, status: 200, data: { id, role: 'admin', adminRole, isBlocked: false } });
  return `Bearer ${generateToken(id, 'admin')}`;
};
const ok = (data) => ({ ok: true, status: 200, message: 'OK', data, meta: {} });
const BOOKING = '11111111-2222-3333-4444-555555555555';

beforeEach(() => jest.resetAllMocks());

describe('Booking Management', () => {
  it('GET /reports/bookings relays the KPI cards for any admin', async () => {
    mockBooking.get.mockResolvedValue(ok({ kpis: { totalBookings: 4 } }));
    const res = await request(app).get('/reports/bookings').set('authorization', signIn('marketing_admin'));
    expect(res.status).toBe(200);
    expect(res.body.data.kpis.totalBookings).toBe(4);
    expect(mockBooking.get).toHaveBeenCalledWith('/internal/bookings/admin/report');
  });

  it('PATCH /bookings/:id/retry-dispatch is for operations', async () => {
    mockBooking.patch.mockResolvedValue(ok({ booking: { status: 'paid_unassigned' } }));
    const res = await request(app).patch(`/bookings/${BOOKING}/retry-dispatch`).set('authorization', signIn('operations_admin'));
    expect(res.status).toBe(200);
    expect(mockBooking.patch).toHaveBeenCalledWith(`/internal/bookings/admin/${BOOKING}/retry-dispatch`, {});

    const denied = await request(app).patch(`/bookings/${BOOKING}/retry-dispatch`).set('authorization', signIn('support_admin'));
    expect(denied.status).toBe(403);
  });

  it('DELETE /bookings/:id is super admin only, with a valid id', async () => {
    mockBooking.del.mockResolvedValue(ok({ id: BOOKING }));
    expect((await request(app).delete(`/bookings/${BOOKING}`).set('authorization', signIn('super_admin'))).status).toBe(200);
    expect(mockBooking.del).toHaveBeenCalledWith(`/internal/bookings/admin/${BOOKING}`);
    expect((await request(app).delete(`/bookings/${BOOKING}`).set('authorization', signIn('operations_admin'))).status).toBe(403);
    expect((await request(app).delete('/bookings/not-an-id').set('authorization', signIn('super_admin'))).status).toBe(400);
  });
});
