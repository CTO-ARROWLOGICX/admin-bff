jest.mock('../src/utils/upstream', () => ({
  maid: { get: jest.fn(), patch: jest.fn() },
  identity: { post: jest.fn() },
  auth: { get: jest.fn(), del: jest.fn() },
}));

const upstream = require('../src/utils/upstream');
const verifications = require('../src/controllers/verificationsController');
const users = require('../src/controllers/userController');

const UUID = '5b4fbb1e-7d0c-4a5e-9c4d-1f2e3a4b5c6d';

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

describe('approveVerificationSchema', () => {
  it('accepts a valid approve body', () => {
    const result = verifications.approveVerificationSchema.safeParse({
      isIdentityVerified: true,
      activeStatus: 'active',
      documentStatus: [{ id: UUID, status: 'verified' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown maid status and a non-uuid document id', () => {
    expect(
      verifications.approveVerificationSchema.safeParse({ isIdentityVerified: true, activeStatus: 'deleted' }).success,
    ).toBe(false);
    expect(
      verifications.approveVerificationSchema.safeParse({
        isIdentityVerified: true,
        activeStatus: 'active',
        documentStatus: [{ id: 'nope', status: 'verified' }],
      }).success,
    ).toBe(false);
  });

  it('defaults documentStatus to an empty list', () => {
    const result = verifications.approveVerificationSchema.parse({ isIdentityVerified: false, activeStatus: 'on-hold' });
    expect(result.documentStatus).toEqual([]);
  });
});

describe('listPending', () => {
  it('adds each maid name from identity-profiles', async () => {
    upstream.maid.get.mockResolvedValue({
      ok: true,
      data: { maids: [{ _id: 'p1', userId: UUID, documents: [] }], total: 1, page: 1, limit: 20 },
    });
    upstream.identity.post.mockResolvedValue({
      ok: true,
      data: { profiles: { [UUID]: { firstName: 'Anita', lastName: 'Rao', name: null } } },
    });
    const res = mockRes();
    await verifications.listPending({ query: { page: '1' } }, res, jest.fn());
    const body = res.json.mock.calls[0][0];
    expect(body.data.maids[0].user).toEqual({ _id: UUID, name: 'Anita Rao' });
    expect(body.data.total).toBe(1);
  });

  it('relays the maid service error unchanged', async () => {
    upstream.maid.get.mockResolvedValue({ ok: false, status: 502, data: null, message: 'down', error: null });
    const res = mockRes();
    await verifications.listPending({ query: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(502);
  });
});

describe('deleteMaid', () => {
  it('refuses an account that is not a maid and deletes nothing', async () => {
    upstream.auth.get.mockResolvedValue({ ok: true, status: 200, data: { id: UUID, role: 'customer' } });
    const res = mockRes();
    await users.deleteMaid({ params: { id: UUID }, admin: { id: 'a' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(upstream.auth.del).not.toHaveBeenCalled();
  });
});
