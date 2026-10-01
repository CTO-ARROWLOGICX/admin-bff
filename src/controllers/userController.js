const { sendResponse, sendError } = require('@zafabit/service-kit');
const upstream = require('../utils/upstream');
const { paginationMeta } = require('../utils/pagination');
const { isSuperAdmin, forgetAccount } = require('../middleware/requireAdmin');

// /admin/users/* — the monolith's user-management contract, composed from
// auth (credentials, role, blocked/verified) and identity-profiles (names,
// addresses, property profile).
//
// Not yet composed (owning services have no internal API yet), returned as
// neutral defaults so the panel renders: maidProfile (maid), wallet balance /
// reward points / referral credits (promotions-rewards), and the
// booking-derived KPIs dau / returningUsers / retention (booking-engine).
// `meta.kpis.unavailable` names the ones that are placeholders.

const PENDING_KPIS = ['dau', 'returningUsers', 'retention'];

// Forward an owning service's refusal (404, 409, validation) as-is.
const relay = (res, result) =>
  sendError(
    res,
    result.status,
    result.message || 'We were unable to complete your request.',
    (result.error && result.error.code) || 'UPSTREAM_ERROR',
    (result.error && result.error.details) || [],
  );

const splitName = (full) => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
};

// The monolith's populated User document, as the panel reads it.
const composeUser = (account, profile) => ({
  _id: account.id,
  id: account.id,
  firstName: (profile && profile.firstName) || null,
  lastName: (profile && profile.lastName) || null,
  name: (profile && profile.name) || null,
  email: account.email,
  phone: account.phone,
  employeeId: account.employeeId,
  role: account.role,
  adminRole: account.adminRole || undefined,
  isVerified: account.isVerified,
  isBlocked: account.isBlocked,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
  addresses: (profile && profile.addresses) || [],
  customerProfile: (profile && profile.customerProfile) || null,
  maidProfile: null,
  walletBalance: 0,
  rewardPoints: 0,
  referralCredits: 0,
});

const fetchProfiles = async (userIds) => {
  if (!userIds.length) return {};
  const result = await upstream.identity.post('/internal/admin/profiles/batch', { userIds });
  return result.ok && result.data ? result.data.profiles || {} : {};
};

const fetchAccount = async (id) => upstream.auth.get(`/internal/users/${id}`);

/**
 * @route GET /admin/users
 * query: role, status, filterType, search, location, propertyType,
 *        memberCount, page, limit
 */
exports.getUsers = async (req, res, next) => {
  try {
    const q = req.validated;
    if (q.role === 'admin' && !isSuperAdmin(req)) {
      return sendError(res, 403, 'Only super admins can access administrator accounts.', 'FORBIDDEN');
    }

    const wantsFilter = q.location || q.propertyType || q.memberCount !== undefined;
    let nameIds = [];
    let onlyIds = [];
    if (q.search || wantsFilter) {
      const match = await upstream.identity.post('/internal/admin/profiles/match', {
        q: q.search,
        location: q.location,
        propertyType: q.propertyType,
        memberCount: q.memberCount,
      });
      if (!match.ok) return relay(res, match);
      nameIds = match.data.nameIds || [];
      onlyIds = match.data.filterIds || [];
    }

    const [list, stats] = await Promise.all([
      wantsFilter && !onlyIds.length
        ? { ok: true, data: { users: [], total: 0 } } // filter matched nobody
        : upstream.auth.post('/internal/admin/users/query', {
            role: q.role,
            status: q.status,
            filterType: q.filterType,
            search: q.search,
            ids: nameIds,
            onlyIds,
            page: q.page,
            limit: q.limit,
          }),
      upstream.auth.get('/internal/admin/users/stats', { role: q.role }),
    ]);
    if (!list.ok) return relay(res, list);
    if (!stats.ok) return relay(res, stats);

    const { users: accounts, total } = list.data;
    const profiles = await fetchProfiles(accounts.map((a) => a.id));

    return sendResponse(
      res,
      200,
      'Users retrieved',
      { users: accounts.map((a) => composeUser(a, profiles[a.id])) },
      {
        pagination: paginationMeta(q.page, q.limit, total),
        kpis: {
          ...stats.data,
          dau: 0,
          returningUsers: 0,
          retention: 0,
          unavailable: PENDING_KPIS,
        },
      },
    );
  } catch (error) {
    next(error);
  }
};

/**
 * @route PATCH /admin/users/:id/status   body: { activeStatus?, isIdentityVerified?, isBlocked? }
 */
exports.updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { activeStatus, isBlocked } = req.validated;

    const target = await fetchAccount(id);
    if (!target.ok) return relay(res, target);
    if (target.data.role === 'admin' && !isSuperAdmin(req)) {
      return sendError(res, 403, 'Only super admins can change administrator status.', 'FORBIDDEN');
    }

    let blocked;
    if (activeStatus === 'suspended' || isBlocked === true) blocked = true;
    else if (activeStatus === 'active' || isBlocked === false) blocked = false;

    let account = target.data;
    if (blocked !== undefined && blocked !== account.isBlocked) {
      const updated = await upstream.auth.patch(`/internal/admin/users/${id}`, { isBlocked: blocked });
      if (!updated.ok) return relay(res, updated);
      account = updated.data;
      forgetAccount(id);
    }

    const profiles = await fetchProfiles([id]);
    return sendResponse(res, 200, 'User status updated', {
      user: composeUser(account, profiles[id]),
      profile: null, // maid activeStatus / isIdentityVerified: pending maid-service internal API
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route PUT /admin/users/:id
 * body: { name? | firstName?/lastName?, email?, phone?, location?, adminRole? }
 */
exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, firstName, lastName, email, phone, location, adminRole } = req.validated;

    const target = await fetchAccount(id);
    if (!target.ok) return relay(res, target);
    const superAdmin = isSuperAdmin(req);
    if (target.data.role === 'admin' && !superAdmin) {
      return sendError(res, 403, 'Only super admins can edit administrator accounts.', 'FORBIDDEN');
    }

    // Credentials first — the step most likely to be refused (taken email).
    const accountPatch = {};
    if (email) accountPatch.email = email;
    if (phone !== undefined) accountPatch.phone = phone || null;
    if (adminRole && superAdmin && target.data.role === 'admin') accountPatch.adminRole = adminRole;

    let account = target.data;
    if (Object.keys(accountPatch).length) {
      const updated = await upstream.auth.patch(`/internal/admin/users/${id}`, accountPatch);
      if (!updated.ok) return relay(res, updated);
      account = updated.data;
      forgetAccount(id);
    }

    let names;
    if (name !== undefined) names = splitName(name);
    else if (firstName !== undefined || lastName !== undefined) names = { firstName, lastName };
    if (names) {
      const updated = await upstream.identity.put(`/internal/profiles/${id}`, names);
      if (!updated.ok) return relay(res, updated);
    }

    if (location) {
      const updated = await upstream.identity.put(`/internal/admin/profiles/${id}/primary-city`, {
        city: location,
      });
      if (!updated.ok) return relay(res, updated);
    }

    const profiles = await fetchProfiles([id]);
    return sendResponse(res, 200, 'User updated successfully', { user: composeUser(account, profiles[id]) });
  } catch (error) {
    next(error);
  }
};

/**
 * @route DELETE /admin/users/:id
 * Removes the credentials (auth) then the profile rows (identity-profiles).
 * Maid profile rows: pending maid-service internal API.
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const target = await fetchAccount(id);
    if (!target.ok) return relay(res, target);
    if (target.data.role === 'admin' && !isSuperAdmin(req)) {
      return sendError(res, 403, 'Only super admins can delete administrator accounts.', 'FORBIDDEN');
    }
    if (id === req.admin.id) {
      return sendError(res, 400, "You can't delete your own account here.", 'CANNOT_DELETE_SELF');
    }

    const removed = await upstream.auth.del(`/internal/admin/users/${id}`);
    if (!removed.ok) return relay(res, removed);
    forgetAccount(id);

    // Best-effort — the account is already gone, so an orphaned profile row
    // is harmless (and identity-profiles' delete is idempotent to retry).
    await upstream.identity.del(`/internal/profiles/${id}`).catch(() => null);

    return sendResponse(res, 200, 'User deleted successfully', { id });
  } catch (error) {
    next(error);
  }
};

/**
 * @route POST /admin/users/create-admin   (super_admin only)
 * body: { firstName, lastName?, email, password, phone?, adminRole? }
 */
exports.createAdmin = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, phone, adminRole } = req.validated;

    const created = await upstream.auth.post('/internal/admin/users', { email, password, phone, adminRole });
    if (!created.ok) return relay(res, created);
    const account = created.data;

    // Best-effort: the account already exists, so a 502 here would invite a
    // retry that then fails with EMAIL_TAKEN. The name can be fixed via PUT.
    const named = await upstream.identity
      .put(`/internal/profiles/${account.id}`, { firstName, lastName: lastName || '' })
      .catch(() => ({ ok: false }));
    const fullName = `${firstName} ${lastName || ''}`.trim();

    return sendResponse(res, 201, 'New administrator account created successfully', {
      id: account.id,
      _id: account.id,
      name: named.ok && named.data ? named.data.name || fullName : fullName,
      email: account.email,
      role: account.role,
      adminRole: account.adminRole,
      isVerified: account.isVerified,
    });
  } catch (error) {
    next(error);
  }
};
