const mockAuth = { get: jest.fn() };
const mockBooking = { get: jest.fn() };

jest.mock('../src/utils/upstream', () => {
  const actual = jest.requireActual('../src/utils/upstream');
  return {
    auth: mockAuth,
    identity: {},
    catalogue: {},
    maid: {},
    booking: mockBooking,
    UpstreamError: actual.UpstreamError,
  };
});

const request = require('supertest');
const { generateToken } = require('@zafabit/service-kit');
const app = require('../src/app');
const { UpstreamError } = require('../src/utils/upstream');

let seq = 0;
const signIn = (adminRole) => {
  seq += 1;
  const id = `dddddddd-dddd-dddd-dddd-${String(seq).padStart(12, '0')}`;
  mockAuth.get.mockResolvedValue({ ok: true, status: 200, data: { id, role: 'admin', adminRole, isBlocked: false } });
  return `Bearer ${generateToken(id, 'admin')}`;
};
const ok = (data, meta = {}) => ({ ok: true, status: 200, message: 'OK', data, meta });

beforeEach(() => jest.resetAllMocks());

describe('GET /reviews', () => {
  it('relays booking-engine reviews with the query and pagination', async () => {
    const token = signIn('support_admin');
    mockBooking.get.mockResolvedValue(ok({ reviews: [{ _id: 'r1', rating: 5 }] }, { pagination: { page: 1 } }));

    const res = await request(app).get('/reviews?sentiment=ALL').set('authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.reviews).toEqual([{ _id: 'r1', rating: 5 }]);
    expect(res.body.meta.pagination).toEqual({ page: 1 });
    expect(mockBooking.get).toHaveBeenCalledWith('/internal/reviews', { sentiment: 'ALL' });
  });

  it('is for admins only, and 502s when booking-engine is down', async () => {
    const customer = `Bearer ${generateToken('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'customer')}`;
    expect((await request(app).get('/reviews').set('authorization', customer)).status).toBe(403);

    const token = signIn('super_admin');
    mockBooking.get.mockRejectedValue(new UpstreamError('booking-engine', 'GET', '/internal/reviews'));
    expect((await request(app).get('/reviews').set('authorization', token)).status).toBe(502);
  });
});

describe('GET /reports/sentiment', () => {
  it('relays the sentiment report', async () => {
    const token = signIn('marketing_admin');
    mockBooking.get.mockResolvedValue(ok([{ _id: 'positive', count: 2, avgRating: 4.5 }]));
    const res = await request(app).get('/reports/sentiment').set('authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ _id: 'positive', count: 2, avgRating: 4.5 }]);
    expect(mockBooking.get).toHaveBeenCalledWith('/internal/reviews/sentiment');
  });
});
