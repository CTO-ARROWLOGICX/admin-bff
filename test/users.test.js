const ok = (data, status = 200) => ({ ok: true, status, data, message: null, error: null });
const fail = (status, code, message = 'nope') => ({
  ok: false,
  status,
  data: null,
  message,
  error: { code, message, details: [] },
});

const mockAuth = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), del: jest.fn() };
const mockIdentity = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), del: jest.fn() };

jest.mock('../src/utils/upstream', () => {
  const actual = jest.requireActual('../src/utils/upstream');
  return { auth: mockAuth, identity: mockIdentity, UpstreamError: actual.UpstreamError };
});

const request = require('supertest');
const { generateToken } = require('@zafabit/service-kit');
const { UpstreamError } = require('../src/utils/upstream');
const app = require('../src/app');

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_ADMIN_ID = '33333333-3333-3333-3333-333333333333';

const account = (over = {}) => ({
  id: USER_ID,
  email: null,
  phone: '+919990000001',
  employeeId: null,
  role: 'customer',
  adminRole: null,
  isVerified: true,
  isBlocked: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

// Each test signs in as a distinct admin id so the 30s role cache never
// carries one test's adminRole into the next.
let adminSeq = 0;
const signIn = (adminRole = 'super_admin', { blocked = false } = {}) => {
  adminSeq += 1;
  const id = `aaaaaaaa-aaaa-aaaa-aaaa-${String(adminSeq).padStart(12, '0')}`;
  const accounts = {
    [id]: account({ id, role: 'admin', adminRole, isBlocked: blocked, email: 'me@zafabit.com' }),
  };
  mockAuth.get.mockImplementation(async (path) => {
    const m = path.match(/^\/internal\/users\/(.+)$/);
    if (m && accounts[m[1]]) return ok(accounts[m[1]]);
    if (m && extraAccounts[m[1]]) return ok(extraAccounts[m[1]]);
    if (m) return fail(404, 'NOT_FOUND');
    if (path === '/internal/admin/users/stats') {
      return ok({ totalUsers: 2, newUsers: 1, activeUsers: 2, inactiveUsers: 0, blockedUsers: 0 });
    }
    throw new Error(`unexpected auth GET ${path}`);
  });
  return { id, token: `Bearer ${generateToken(id, 'admin')}` };
};
let extraAccounts = {};

beforeEach(() => {
  jest.resetAllMocks();
  extraAccounts = {};
});

describe('admin guard', () => {
  it('401s without a token', async () => {
    expect((await request(app).get('/users')).status).toBe(401);
  });

  it('403s a non-admin token', async () => {
    const res = await request(app)
      .get('/users')
      .set('authorization', `Bearer ${generateToken(USER_ID, 'customer')}`);
    expect(res.status).toBe(403);
  });

  it('403s a blocked admin', async () => {
    const { token } = signIn('super_admin', { blocked: true });
    const res = await request(app).get('/users').set('authorization', token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_BLOCKED');
  });

  it('enforces adminRole per route (finance cannot list users)', async () => {
    const { token } = signIn('finance_admin');
    const res = await request(app).get('/users').set('authorization', token);
    expect(res.status).toBe(403);
  });

  it('502s (not 500) when auth is unreachable', async () => {
    mockAuth.get.mockRejectedValue(new UpstreamError('auth', 'GET', '/internal/users/x'));
    const res = await request(app)
      .get('/users')
      .set('authorization', `Bearer ${generateToken(OTHER_ADMIN_ID, 'admin')}`);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});

describe('GET /users', () => {
  it('composes auth accounts with identity profiles, monolith-shaped', async () => {
    const { token } = signIn('support_admin');
    mockAuth.post.mockResolvedValue(ok({ users: [account()], total: 1 }));
    mockIdentity.post.mockImplementation(async (path) => {
      if (path === '/internal/admin/profiles/batch') {
        return ok({ profiles: { [USER_ID]: { firstName: 'Asha', lastName: 'K', name: 'Asha K', addresses: [{ city: 'Kochi' }] } } });
      }
      throw new Error(`unexpected identity POST ${path}`);
    });

    const res = await request(app).get('/users?role=customer&page=1&limit=10&status=all').set('authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.data.users[0]).toMatchObject({
      _id: USER_ID,
      name: 'Asha K',
      phone: '+919990000001',
      addresses: [{ city: 'Kochi' }],
      walletBalance: 0,
    });
    expect(res.body.meta.pagination).toMatchObject({ page: 1, perPage: 10, totalItems: 1 });
    expect(res.body.meta.kpis).toMatchObject({ totalUsers: 2, unavailable: ['dau', 'returningUsers', 'retention'] });
    // 'all' status is "no filter"
    expect(mockAuth.post.mock.calls[0][1].status).toBeUndefined();
  });

  it('widens search with identity name matches', async () => {
    const { token } = signIn();
    mockIdentity.post.mockImplementation(async (path) =>
      path.endsWith('/match') ? ok({ nameIds: [USER_ID], filterIds: null }) : ok({ profiles: {} }),
    );
    mockAuth.post.mockResolvedValue(ok({ users: [], total: 0 }));

    await request(app).get('/users?search=asha').set('authorization', token);
    expect(mockAuth.post.mock.calls[0][1]).toMatchObject({ search: 'asha', ids: [USER_ID], onlyIds: [] });
  });

  it('short-circuits when a location filter matches nobody', async () => {
    const { token } = signIn();
    mockIdentity.post.mockResolvedValue(ok({ nameIds: null, filterIds: [] }));
    const res = await request(app).get('/users?location=Nowhere').set('authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.users).toEqual([]);
    expect(mockAuth.post).not.toHaveBeenCalled();
  });

  it('only super admins may list admins', async () => {
    const { token } = signIn('operations_admin');
    const res = await request(app).get('/users?role=admin').set('authorization', token);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /users/:id/status', () => {
  it('suspends via auth', async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[USER_ID] = account();
    mockAuth.patch.mockResolvedValue(ok(account({ isBlocked: true })));
    mockIdentity.post.mockResolvedValue(ok({ profiles: {} }));

    const res = await request(app)
      .patch(`/users/${USER_ID}/status`)
      .set('authorization', token)
      .send({ activeStatus: 'suspended' });

    expect(res.status).toBe(200);
    expect(mockAuth.patch).toHaveBeenCalledWith(`/internal/admin/users/${USER_ID}`, { isBlocked: true });
    expect(res.body.data.user.isBlocked).toBe(true);
  });

  it('operations admins cannot change an admin', async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[OTHER_ADMIN_ID] = account({ id: OTHER_ADMIN_ID, role: 'admin', adminRole: 'support_admin' });
    const res = await request(app)
      .patch(`/users/${OTHER_ADMIN_ID}/status`)
      .set('authorization', token)
      .send({ isBlocked: true });
    expect(res.status).toBe(403);
    expect(mockAuth.patch).not.toHaveBeenCalled();
  });

  it('relays auth 404 for an unknown user', async () => {
    const { token } = signIn();
    const res = await request(app)
      .patch(`/users/${USER_ID}/status`)
      .set('authorization', token)
      .send({ isBlocked: true });
    expect(res.status).toBe(404);
  });
});

describe('PUT /users/:id', () => {
  it('splits name into identity, email into auth, location into primary-city', async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[USER_ID] = account();
    mockAuth.patch.mockResolvedValue(ok(account({ email: 'asha@x.com' })));
    mockIdentity.put.mockResolvedValue(ok({}));
    mockIdentity.post.mockResolvedValue(ok({ profiles: {} }));

    const res = await request(app)
      .put(`/users/${USER_ID}`)
      .set('authorization', token)
      .send({ name: 'Asha Mary K', email: 'asha@x.com', location: 'Kochi', adminRole: 'super_admin' });

    expect(res.status).toBe(200);
    // adminRole is dropped: target isn't an admin and caller isn't super.
    expect(mockAuth.patch).toHaveBeenCalledWith(`/internal/admin/users/${USER_ID}`, { email: 'asha@x.com' });
    expect(mockIdentity.put).toHaveBeenCalledWith(`/internal/profiles/${USER_ID}`, {
      firstName: 'Asha',
      lastName: 'Mary K',
    });
    expect(mockIdentity.put).toHaveBeenCalledWith(`/internal/admin/profiles/${USER_ID}/primary-city`, {
      city: 'Kochi',
    });
  });

  it('relays a 409 from auth and skips the profile write', async () => {
    const { token } = signIn();
    extraAccounts[USER_ID] = account();
    mockAuth.patch.mockResolvedValue(fail(409, 'ACCOUNT_TAKEN', 'That email or phone number is already in use.'));
    const res = await request(app).put(`/users/${USER_ID}`).set('authorization', token).send({ email: 'x@y.com', name: 'A' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ACCOUNT_TAKEN');
    expect(mockIdentity.put).not.toHaveBeenCalled();
  });
});

describe('DELETE /users/:id', () => {
  it('deletes in auth then identity', async () => {
    const { token } = signIn();
    extraAccounts[USER_ID] = account();
    mockAuth.del.mockResolvedValue(ok({}));
    mockIdentity.del.mockResolvedValue(ok({}));
    const res = await request(app).delete(`/users/${USER_ID}`).set('authorization', token);
    expect(res.status).toBe(200);
    expect(mockAuth.del).toHaveBeenCalledWith(`/internal/admin/users/${USER_ID}`);
    expect(mockIdentity.del).toHaveBeenCalledWith(`/internal/profiles/${USER_ID}`);
  });

  it("won't delete the caller's own account", async () => {
    const { id, token } = signIn();
    const res = await request(app).delete(`/users/${id}`).set('authorization', token);
    expect(res.status).toBe(400);
    expect(mockAuth.del).not.toHaveBeenCalled();
  });
});

describe('POST /users/create-admin', () => {
  it('is super-admin only', async () => {
    const { token } = signIn('operations_admin');
    const res = await request(app)
      .post('/users/create-admin')
      .set('authorization', token)
      .send({ firstName: 'New', email: 'n@zafabit.com', password: 'longenough' });
    expect(res.status).toBe(403);
  });

  it('creates in auth, names in identity, falls back to operations_admin', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(
      ok(account({ id: OTHER_ADMIN_ID, role: 'admin', adminRole: 'operations_admin', email: 'n@zafabit.com' }), 201),
    );
    mockIdentity.put.mockResolvedValue(ok({ name: 'New Admin' }));

    const res = await request(app)
      .post('/users/create-admin')
      .set('authorization', token)
      .send({ firstName: 'New', lastName: 'Admin', email: 'n@zafabit.com', password: 'longenough', adminRole: 'bogus' });

    expect(res.status).toBe(201);
    expect(mockAuth.post.mock.calls[0][1]).toMatchObject({ adminRole: 'operations_admin' });
    expect(res.body.data).toMatchObject({ id: OTHER_ADMIN_ID, name: 'New Admin', adminRole: 'operations_admin' });
  });

  it('still 201s if naming the profile fails after the account exists', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(ok(account({ id: OTHER_ADMIN_ID, role: 'admin', adminRole: 'operations_admin' }), 201));
    mockIdentity.put.mockRejectedValue(new UpstreamError('identity-profiles', 'PUT', '/x'));
    const res = await request(app)
      .post('/users/create-admin')
      .set('authorization', token)
      .send({ firstName: 'New', email: 'n@zafabit.com', password: 'longenough' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('New');
  });
});
