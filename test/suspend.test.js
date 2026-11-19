jest.mock('../src/utils/upstream', () => ({
  auth: { get: jest.fn(), patch: jest.fn() },
  booking: { get: jest.fn() },
  identity: { post: jest.fn() },
  maid: { post: jest.fn() },
}));

const upstream = require('../src/utils/upstream');
const users = require('../src/controllers/userController');

const MAID = '5b4fbb1e-7d0c-4a5e-9c4d-1f2e3a4b5c6d';
const ADMIN = '11111111-2222-4333-8444-555555555555';

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const req = (role, isBlocked = false) => ({
  params: { id: MAID },
  validated: { isBlocked: true },
  admin: { id: ADMIN, adminRole: 'super_admin' },
  _role: role,
  _isBlocked: isBlocked,
});

beforeEach(() => {
  jest.clearAllMocks();
  upstream.auth.get.mockImplementation(async () => ({
    ok: true,
    status: 200,
    data: { id: MAID, role: 'maid', isBlocked: false },
  }));
});

test('refuses to suspend a maid who is on an active job', async () => {
  upstream.booking.get.mockResolvedValue({
    ok: true,
    data: { bookings: [{ bookingId: 'b1', status: 'ongoing' }] },
  });
  const res = mockRes();
  await users.updateUserStatus(req('maid'), res, jest.fn());
  expect(upstream.booking.get).toHaveBeenCalledWith(`/internal/maids/${MAID}/active-jobs`);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(upstream.auth.patch).not.toHaveBeenCalled();
});

test('suspends a maid with no active job', async () => {
  upstream.booking.get.mockResolvedValue({ ok: true, data: { bookings: [] } });
  upstream.auth.patch.mockResolvedValue({ ok: true, status: 200, data: { id: MAID, role: 'maid', isBlocked: true } });
  upstream.identity.post.mockResolvedValue({ ok: true, data: { profiles: {} } });
  upstream.maid.post.mockResolvedValue({ ok: true, data: { profiles: {} } });
  const res = mockRes();
  await users.updateUserStatus(req('maid'), res, jest.fn());
  expect(upstream.auth.patch).toHaveBeenCalledWith(`/internal/admin/users/${MAID}`, { isBlocked: true });
});

test('does not check jobs when suspending a customer', async () => {
  upstream.auth.get.mockResolvedValue({ ok: true, status: 200, data: { id: MAID, role: 'customer', isBlocked: false } });
  upstream.auth.patch.mockResolvedValue({ ok: true, status: 200, data: { id: MAID, role: 'customer', isBlocked: true } });
  upstream.identity.post.mockResolvedValue({ ok: true, data: { profiles: {} } });
  upstream.maid.post.mockResolvedValue({ ok: true, data: { profiles: {} } });
  const res = mockRes();
  await users.updateUserStatus(req('customer'), res, jest.fn());
  expect(upstream.booking.get).not.toHaveBeenCalled();
});
