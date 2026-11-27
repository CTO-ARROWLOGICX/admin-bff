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
const mockMaid = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), del: jest.fn(), forward: jest.fn() };

jest.mock('../src/utils/upstream', () => {
  const actual = jest.requireActual('../src/utils/upstream');
  return { auth: mockAuth, identity: mockIdentity, maid: mockMaid, UpstreamError: actual.UpstreamError };
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
const signIn = (adminRole = 'super_admin', { blocked = false, status } = {}) => {
  adminSeq += 1;
  const id = `aaaaaaaa-aaaa-aaaa-aaaa-${String(adminSeq).padStart(12, '0')}`;
  const accounts = {
    [id]: account({ id, role: 'admin', adminRole, isBlocked: blocked, email: 'me@zafabit.com', ...(status ? { status } : {}) }),
  };
  mockAuth.get.mockImplementation(async (path, query) => {
    if (extraAuthGet) {
      const answer = await extraAuthGet(path, query);
      if (answer) return answer;
    }
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
let extraAuthGet = null; // (path, query) => result | undefined

beforeEach(() => {
  jest.resetAllMocks();
  extraAccounts = {};
  extraAuthGet = null;
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

  it.each(['pending_deletion', 'deleting', 'deleted'])('403s an admin whose account is %s', async (status) => {
    const { token } = signIn('super_admin', { status });
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

  it('accepts the pending_deletion and deleted status filters', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(ok({ users: [], total: 0 }));
    for (const status of ['pending_deletion', 'deleted']) {
      const res = await request(app).get(`/users?status=${status}`).set('authorization', token);
      expect(res.status).toBe(200);
    }
    expect(mockAuth.post.mock.calls.map((c) => c[1].status)).toEqual(['pending_deletion', 'deleted']);
    expect((await request(app).get('/users?status=bogus').set('authorization', token)).status).toBe(400);
  });

  it('passes the lifecycle fields and deleted profiles through', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(
      ok({
        users: [
          account({
            status: 'pending_deletion',
            deletionRequestedAt: '2026-11-01T00:00:00.000Z',
            deletionScheduledFor: '2026-12-01T00:00:00.000Z',
            isReturningUser: true,
          }),
        ],
        total: 1,
      }),
    );
    mockIdentity.post.mockResolvedValue(
      ok({ profiles: { [USER_ID]: { deleted: true, name: 'Deleted user', firstName: null, lastName: null } } }),
    );
    const res = await request(app).get('/users').set('authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.users[0]).toMatchObject({
      status: 'pending_deletion',
      deletionRequestedAt: '2026-11-01T00:00:00.000Z',
      deletionScheduledFor: '2026-12-01T00:00:00.000Z',
      deletedAt: null,
      isReturningUser: true,
      deleted: true,
      name: 'Deleted user',
      firstName: null,
    });
  });

  it('defaults status to active for accounts without one', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(ok({ users: [account()], total: 1 }));
    mockIdentity.post.mockResolvedValue(ok({ profiles: {} }));
    const res = await request(app).get('/users').set('authorization', token);
    expect(res.body.data.users[0]).toMatchObject({ status: 'active', deleted: false, isReturningUser: false });
  });

  it('only super admins may list admins', async () => {
    const { token } = signIn('operations_admin');
    const res = await request(app).get('/users?role=admin').set('authorization', token);
    expect(res.status).toBe(403);
  });
});

describe('maidProfile composition', () => {
  const MAID_ID = '44444444-4444-4444-4444-444444444444';
  const maidProfile = { userId: MAID_ID, activeStatus: 'active', isIdentityVerified: true, zone: 'Kochi 1' };

  it('GET /users fills maidProfile for maid accounts only', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(
      ok({ users: [account({ id: MAID_ID, role: 'maid' }), account()], total: 2 }),
    );
    mockIdentity.post.mockResolvedValue(ok({ profiles: {} }));
    mockMaid.post.mockResolvedValue(ok({ profiles: { [MAID_ID]: maidProfile } }));

    const res = await request(app).get('/users?role=maid').set('authorization', token);

    expect(res.status).toBe(200);
    expect(mockMaid.post).toHaveBeenCalledWith('/internal/maids/profiles/batch', { userIds: [MAID_ID] });
    const [maid, customer] = res.body.data.users;
    expect(maid.maidProfile).toEqual(maidProfile);
    expect(customer.maidProfile).toBeNull();
  });

  it('GET /users still answers when maid-service is down', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(ok({ users: [account({ id: MAID_ID, role: 'maid' })], total: 1 }));
    mockIdentity.post.mockResolvedValue(ok({ profiles: {} }));
    mockMaid.post.mockRejectedValue(new UpstreamError('maid', 'down'));

    const res = await request(app).get('/users?role=maid').set('authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data.users[0].maidProfile).toBeNull();
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

  it('sends a maid password to auth and the maid fields to maid-service', async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[USER_ID] = account({ role: 'maid' });
    mockAuth.patch.mockResolvedValue(ok(account({ role: 'maid' })));
    mockIdentity.put.mockResolvedValue(ok({}));
    mockIdentity.post.mockResolvedValue(ok({ profiles: {} }));
    const maidProfile = { userId: USER_ID, zone: 'Kochi 1', activeStatus: 'active', isIdentityVerified: true };
    mockMaid.patch.mockResolvedValue(ok(maidProfile));

    const res = await request(app)
      .put(`/users/${USER_ID}`)
      .set('authorization', token)
      .send({
        name: 'Asha',
        password: 'secret123',
        zone: 'Kochi 1',
        jobType: 'part_time',
        language: 'ml',
        activeStatus: 'active',
        isIdentityVerified: true,
      });

    expect(res.status).toBe(200);
    expect(mockAuth.patch).toHaveBeenCalledWith(`/internal/admin/users/${USER_ID}`, { password: 'secret123' });
    expect(mockMaid.patch).toHaveBeenCalledWith(`/internal/maids/${USER_ID}/profile`, {
      zone: 'Kochi 1',
      jobType: 'part_time',
      language: 'ml',
      activeStatus: 'active',
      isIdentityVerified: true,
    });
    expect(res.body.data.user.maidProfile).toEqual(maidProfile);
  });

  it('treats an empty password as unchanged and skips maid-service when no maid field is sent', async () => {
    const { token } = signIn();
    extraAccounts[USER_ID] = account({ role: 'maid' });
    mockIdentity.put.mockResolvedValue(ok({}));
    mockIdentity.post.mockResolvedValue(ok({ profiles: {} }));
    const res = await request(app).put(`/users/${USER_ID}`).set('authorization', token).send({ name: 'Asha', password: '' });
    expect(res.status).toBe(200);
    expect(mockAuth.patch).not.toHaveBeenCalled();
    expect(mockMaid.patch).not.toHaveBeenCalled();
  });

  it('rejects maid fields on a non-maid account', async () => {
    const { token } = signIn();
    extraAccounts[USER_ID] = account();
    const res = await request(app).put(`/users/${USER_ID}`).set('authorization', token).send({ activeStatus: 'active' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_A_MAID');
    expect(mockMaid.patch).not.toHaveBeenCalled();
  });

  it('relays a maid-service validation error', async () => {
    const { token } = signIn();
    extraAccounts[USER_ID] = account({ role: 'maid' });
    mockMaid.patch.mockResolvedValue(fail(400, 'VALIDATION_ERROR', 'Status is not valid.'));
    const res = await request(app).put(`/users/${USER_ID}`).set('authorization', token).send({ activeStatus: 'bogus' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /users/:id/liveness-checks', () => {
  const MAID_ID = '44444444-4444-4444-4444-444444444444';
  const checks = [{ sessionId: 'a', status: 'passed', confidence: 97.4, faceMatchSimilarity: 96, faceMatchPassed: true }];

  it("relays a maid's face-verification history from maid-service", async () => {
    const { token } = signIn('support_admin');
    extraAccounts[MAID_ID] = account({ id: MAID_ID, role: 'maid' });
    mockMaid.get.mockResolvedValue(ok({ checks }));

    const res = await request(app).get(`/users/${MAID_ID}/liveness-checks`).set('authorization', token);

    expect(res.status).toBe(200);
    expect(mockMaid.get).toHaveBeenCalledWith(`/internal/maids/${MAID_ID}/liveness-checks`);
    expect(res.body.data.checks).toEqual(checks);
  });

  it('rejects a non-maid account before calling maid-service', async () => {
    const { token } = signIn();
    extraAccounts[USER_ID] = account();
    const res = await request(app).get(`/users/${USER_ID}/liveness-checks`).set('authorization', token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_A_MAID');
    expect(mockMaid.get).not.toHaveBeenCalled();
  });
});

describe('PUT /users/:id/photo', () => {
  const MAID_ID = '44444444-4444-4444-4444-444444444444';

  it("relays the admin's photo upload to maid-service as the maid's enrollment photo", async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[MAID_ID] = account({ id: MAID_ID, role: 'maid' });
    mockMaid.forward.mockResolvedValue(ok({ userId: MAID_ID, selfieUrl: '/uploads/selfies/x.jpg' }));

    const res = await request(app)
      .put(`/users/${MAID_ID}/photo`)
      .set('authorization', token)
      .attach('photo', Buffer.from('fake-image-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(mockMaid.forward).toHaveBeenCalledWith(`/internal/maids/${MAID_ID}/photo`, expect.anything());
    expect(res.body.data.selfieUrl).toBe('/uploads/selfies/x.jpg');
  });

  it('rejects a non-maid account before calling maid-service', async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[USER_ID] = account();
    const res = await request(app)
      .put(`/users/${USER_ID}/photo`)
      .set('authorization', token)
      .attach('photo', Buffer.from('fake-image-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_A_MAID');
    expect(mockMaid.forward).not.toHaveBeenCalled();
  });
});

describe('DELETE /users/:id', () => {
  const del = (token, path = `/users/${USER_ID}`) => request(app).delete(path).set('authorization', token);

  it('asks auth to delete with the reason and requester; no identity call (auth fans out)', async () => {
    const { id, token } = signIn('operations_admin');
    extraAccounts[USER_ID] = account();
    mockAuth.del.mockResolvedValue(
      ok(account({ status: 'pending_deletion', deletionScheduledFor: '2026-12-27T00:00:00.000Z' })),
    );
    const res = await del(token).send({ reason: 'Asked by email' });
    expect(res.status).toBe(200);
    expect(mockAuth.del).toHaveBeenCalledWith(`/internal/admin/users/${USER_ID}`, {
      immediate: false,
      reason: 'Asked by email',
      requestedBy: id,
    });
    expect(mockIdentity.del).not.toHaveBeenCalled();
    expect(res.body.message).toBe('Account scheduled for deletion in 30 days.');
    expect(res.body.data).toMatchObject({
      id: USER_ID,
      status: 'pending_deletion',
      deletionScheduledFor: '2026-12-27T00:00:00.000Z',
    });
  });

  it('accepts reason and immediate in the query string; super admins get immediate', async () => {
    const { id, token } = signIn();
    extraAccounts[USER_ID] = account();
    mockAuth.del.mockResolvedValue(ok(account({ status: 'deleted', deletedAt: '2026-11-27T00:00:00.000Z' })));
    const res = await del(token, `/users/${USER_ID}?immediate=true&reason=Court%20order`);
    expect(res.status).toBe(200);
    expect(mockAuth.del).toHaveBeenCalledWith(`/internal/admin/users/${USER_ID}`, {
      immediate: true,
      reason: 'Court order',
      requestedBy: id,
    });
    expect(res.body.message).toBe('User deleted successfully');
  });

  it('ignores immediate from a non-super admin (30-day grace instead)', async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[USER_ID] = account();
    mockAuth.del.mockResolvedValue(ok(account({ status: 'pending_deletion' })));
    const res = await del(token).send({ reason: 'Asked by phone', immediate: true });
    expect(res.status).toBe(200);
    expect(mockAuth.del.mock.calls[0][1].immediate).toBe(false);
  });

  it('requires a reason', async () => {
    const { token } = signIn();
    extraAccounts[USER_ID] = account();
    const res = await del(token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockAuth.del).not.toHaveBeenCalled();
  });

  it("relays auth's blockers unchanged", async () => {
    const { token } = signIn();
    extraAccounts[USER_ID] = account();
    const blockers = [
      { service: 'booking-engine', code: 'OPEN_BOOKINGS', message: 'This person has 2 upcoming bookings.', count: 2 },
    ];
    mockAuth.del.mockResolvedValue({
      ok: false,
      status: 409,
      data: null,
      message: "We couldn't delete this account yet.",
      error: { code: 'DELETION_BLOCKED', message: "We couldn't delete this account yet.", details: blockers },
    });
    const res = await del(token).send({ reason: 'Asked by email' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DELETION_BLOCKED');
    expect(res.body.error.details).toEqual(blockers);
  });

  it('relays 503 DELETION_CHECK_UNAVAILABLE with the unreachable services', async () => {
    const { token } = signIn();
    extraAccounts[USER_ID] = account();
    mockAuth.del.mockResolvedValue({
      ok: false,
      status: 503,
      data: null,
      message: 'down',
      error: { code: 'DELETION_CHECK_UNAVAILABLE', message: 'down', details: [{ service: 'payments' }] },
    });
    const res = await del(token).send({ reason: 'Asked by email' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'DELETION_CHECK_UNAVAILABLE', details: [{ service: 'payments' }] });
  });

  it('only super admins may delete an admin', async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[OTHER_ADMIN_ID] = account({ id: OTHER_ADMIN_ID, role: 'admin', adminRole: 'support_admin' });
    const res = await del(token, `/users/${OTHER_ADMIN_ID}`).send({ reason: 'Left the company' });
    expect(res.status).toBe(403);
    expect(mockAuth.del).not.toHaveBeenCalled();
  });

  it("won't delete the caller's own account", async () => {
    const { id, token } = signIn();
    const res = await del(token, `/users/${id}`).send({ reason: 'Leaving' });
    expect(res.status).toBe(400);
    expect(mockAuth.del).not.toHaveBeenCalled();
  });

  it('DELETE /maids/:id runs the same deletion for a maid', async () => {
    const MAID_ID = '44444444-4444-4444-4444-444444444444';
    const { id, token } = signIn('operations_admin');
    extraAccounts[MAID_ID] = account({ id: MAID_ID, role: 'maid' });
    mockAuth.del.mockResolvedValue(ok(account({ id: MAID_ID, role: 'maid', status: 'pending_deletion' })));
    const res = await del(token, `/maids/${MAID_ID}`).send({ reason: 'Left the platform' });
    expect(res.status).toBe(200);
    expect(mockAuth.del).toHaveBeenCalledWith(`/internal/admin/users/${MAID_ID}`, {
      immediate: false,
      reason: 'Left the platform',
      requestedBy: id,
    });
  });
});

describe('GET /users/:id/deletion-blockers', () => {
  it('relays the blockers and unavailable services', async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[USER_ID] = account();
    const blockers = [{ service: 'payments', code: 'WALLET_BALANCE', message: 'Wallet has a balance.', count: 1 }];
    extraAuthGet = (path) =>
      path === `/internal/admin/users/${USER_ID}/deletion-blockers` ? ok({ blockers, unavailable: ['maid'] }) : undefined;
    const res = await request(app).get(`/users/${USER_ID}/deletion-blockers`).set('authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ blockers, unavailable: ['maid'] });
  });

  it('is closed to support admins', async () => {
    const { token } = signIn('support_admin');
    const res = await request(app).get(`/users/${USER_ID}/deletion-blockers`).set('authorization', token);
    expect(res.status).toBe(403);
  });
});

describe('POST /users/:id/restore', () => {
  it('restores via auth and returns the composed user', async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[USER_ID] = account({ status: 'pending_deletion' });
    mockAuth.post.mockResolvedValue(ok(account({ status: 'active' })));
    mockIdentity.post.mockResolvedValue(ok({ profiles: { [USER_ID]: { name: 'Asha K' } } }));
    const res = await request(app).post(`/users/${USER_ID}/restore`).set('authorization', token);
    expect(res.status).toBe(200);
    expect(mockAuth.post).toHaveBeenCalledWith(`/internal/admin/users/${USER_ID}/restore`, {});
    expect(res.body.data.user).toMatchObject({ id: USER_ID, status: 'active', name: 'Asha K' });
  });

  it('relays 409 NOT_PENDING_DELETION', async () => {
    const { token } = signIn();
    extraAccounts[USER_ID] = account();
    mockAuth.post.mockResolvedValue(fail(409, 'NOT_PENDING_DELETION'));
    const res = await request(app).post(`/users/${USER_ID}/restore`).set('authorization', token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_PENDING_DELETION');
  });

  it('only super admins may restore an admin', async () => {
    const { token } = signIn('operations_admin');
    extraAccounts[OTHER_ADMIN_ID] = account({ id: OTHER_ADMIN_ID, role: 'admin', status: 'pending_deletion' });
    const res = await request(app).post(`/users/${OTHER_ADMIN_ID}/restore`).set('authorization', token);
    expect(res.status).toBe(403);
    expect(mockAuth.post).not.toHaveBeenCalled();
  });
});

describe('GET /users/:id/legal-hold', () => {
  const record = {
    userId: USER_ID,
    role: 'customer',
    name: 'Asha K',
    phone: '+919990000001',
    email: null,
    employeeId: null,
    reasons: [{ code: 'SOS', message: 'Raised an SOS.', count: 1 }],
    createdAt: '2026-11-01T00:00:00.000Z',
    purgeAfter: '2033-11-01T00:00:00.000Z',
  };

  it('relays the locked record with the admin id and reason', async () => {
    const { id, token } = signIn();
    extraAuthGet = (path) => (path === `/internal/admin/legal-holds/${USER_ID}` ? ok(record) : undefined);
    const res = await request(app)
      .get(`/users/${USER_ID}/legal-hold`)
      .query({ reason: 'Police request ref 42/2026' })
      .set('authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(record);
    expect(mockAuth.get).toHaveBeenCalledWith(`/internal/admin/legal-holds/${USER_ID}`, {
      adminId: id,
      reason: 'Police request ref 42/2026',
    });
  });

  it('requires a reason of at least 10 characters', async () => {
    const { token } = signIn();
    const res = await request(app).get(`/users/${USER_ID}/legal-hold?reason=short`).set('authorization', token);
    expect(res.status).toBe(400);
    expect(mockAuth.get).not.toHaveBeenCalledWith(expect.stringContaining('legal-holds'), expect.anything());
  });

  it('is super admin only', async () => {
    const { token } = signIn('operations_admin');
    const res = await request(app)
      .get(`/users/${USER_ID}/legal-hold?reason=Police%20request%20ref%2042`)
      .set('authorization', token);
    expect(res.status).toBe(403);
  });

  it('relays 404 when there is no hold', async () => {
    const { token } = signIn();
    extraAuthGet = (path) => (path.startsWith('/internal/admin/legal-holds/') ? fail(404, 'NOT_FOUND') : undefined);
    const res = await request(app)
      .get(`/users/${USER_ID}/legal-hold?reason=Police%20request%20ref%2042`)
      .set('authorization', token);
    expect(res.status).toBe(404);
  });

  it('access log is super admin only and relays the entries', async () => {
    const entries = [{ adminId: ADMIN_ID, reason: 'Police request ref 42', accessedAt: '2026-11-20T00:00:00.000Z' }];
    extraAuthGet = (path) =>
      path === `/internal/admin/legal-holds/${USER_ID}/access-log` ? ok({ entries }) : undefined;
    const ops = signIn('operations_admin');
    expect((await request(app).get(`/users/${USER_ID}/legal-hold/access-log`).set('authorization', ops.token)).status).toBe(403);
    const sup = signIn();
    const res = await request(app).get(`/users/${USER_ID}/legal-hold/access-log`).set('authorization', sup.token);
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toEqual(entries);
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

describe('POST /maids', () => {
  const MAID_ID = '44444444-4444-4444-4444-444444444444';
  const form = {
    name: 'Lakshmi Nair',
    email: 'lakshmi@zafabit.com',
    password: 'longenough',
    phone: '+919876543210',
    zone: 'Infopark',
    jobType: 'part_time',
    language: 'ml',
    rating: 5,
    completedJobs: 120,
    totalEarnings: 99999,
    activeStatus: 'inactive',
    isIdentityVerified: true,
  };
  const maidAccount = () =>
    account({ id: MAID_ID, role: 'maid', email: form.email, phone: form.phone, employeeId: 'MAID0007' });
  const create = (token, body = form) => request(app).post('/maids').set('authorization', token).send(body);

  it('is closed to support and marketing admins', async () => {
    const { token } = signIn('support_admin');
    expect((await create(token)).status).toBe(403);
    expect(mockAuth.post).not.toHaveBeenCalled();
  });

  it('creates the account, then the maid profile and name, dropping the earned stats', async () => {
    const { token } = signIn('operations_admin');
    mockAuth.post.mockResolvedValue(ok(maidAccount(), 201));
    mockMaid.patch.mockResolvedValue(ok({ zone: 'Infopark', jobType: 'part_time', activeStatus: 'inactive' }));
    mockIdentity.put.mockResolvedValue(ok({ name: 'Lakshmi Nair' }));

    const res = await create(token);

    expect(res.status).toBe(201);
    expect(mockAuth.post).toHaveBeenCalledWith('/internal/admin/maids', {
      email: form.email,
      password: form.password,
      phone: form.phone,
      isVerified: true,
    });
    expect(mockMaid.patch).toHaveBeenCalledWith(`/internal/maids/${MAID_ID}/profile`, {
      zone: 'Infopark',
      jobType: 'part_time',
      language: 'ml',
      activeStatus: 'inactive',
      isIdentityVerified: true,
    });
    expect(mockIdentity.put).toHaveBeenCalledWith(`/internal/profiles/${MAID_ID}`, {
      firstName: 'Lakshmi',
      lastName: 'Nair',
    });
    expect(res.body.data.user).toMatchObject({ id: MAID_ID, name: 'Lakshmi Nair', employeeId: 'MAID0007', role: 'maid' });
    expect(res.body.data.profile).toMatchObject({ zone: 'Infopark' });
  });

  it('rejects a form missing a required field before touching auth', async () => {
    const { token } = signIn();
    const res = await create(token, { ...form, zone: '' });
    expect(res.status).toBe(400);
    expect(mockAuth.post).not.toHaveBeenCalled();
  });

  it('relays a taken email from auth', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(fail(409, 'EMAIL_TAKEN'));
    const res = await create(token);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(mockMaid.patch).not.toHaveBeenCalled();
  });

  it('undoes the account when maid-service refuses the profile', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(ok(maidAccount(), 201));
    mockAuth.del.mockResolvedValue(ok({ id: MAID_ID }));
    mockMaid.patch.mockResolvedValue(fail(400, 'VALIDATION_ERROR'));

    const res = await create(token, { ...form, jobType: 'night_shift' });

    expect(res.status).toBe(400);
    // A hard rollback, not the 30-day deletion.
    expect(mockAuth.del).toHaveBeenCalledWith(`/internal/admin/users/${MAID_ID}`, { rollback: true });
    expect(mockIdentity.put).not.toHaveBeenCalled();
  });

  it('undoes the account and 502s when maid-service is down', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(ok(maidAccount(), 201));
    mockAuth.del.mockResolvedValue(ok({ id: MAID_ID }));
    mockMaid.patch.mockRejectedValue(new UpstreamError('maid', 'PATCH', '/x'));

    const res = await create(token);

    expect(res.status).toBe(502);
    expect(mockAuth.del).toHaveBeenCalledWith(`/internal/admin/users/${MAID_ID}`, { rollback: true });
  });

  it('still 201s if naming the profile fails', async () => {
    const { token } = signIn();
    mockAuth.post.mockResolvedValue(ok(maidAccount(), 201));
    mockMaid.patch.mockResolvedValue(ok({ zone: 'Infopark' }));
    mockIdentity.put.mockRejectedValue(new UpstreamError('identity-profiles', 'PUT', '/x'));
    const res = await create(token);
    expect(res.status).toBe(201);
    expect(res.body.data.user.name).toBe('Lakshmi Nair');
  });
});
