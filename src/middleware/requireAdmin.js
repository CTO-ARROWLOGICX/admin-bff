const { protect, sendError } = require('@zafabit/service-kit');
const { env } = require('../config/env');
const upstream = require('../utils/upstream');

// Staging tokens carry only { id, role } — the admin's sub-role and blocked
// flag live in auth. Look them up per caller (briefly cached, so a page that
// fires a dozen requests costs one lookup) and attach `req.admin`.

const ADMIN_ROLES = {
  SUPER: 'super_admin',
  OPERATIONS: 'operations_admin',
  FINANCE: 'finance_admin',
  SUPPORT: 'support_admin',
  MARKETING: 'marketing_admin',
};
const ALL_ADMINS = Object.values(ADMIN_ROLES);

const cache = new Map(); // userId -> { expiresAt, account }

const lookupAccount = async (userId) => {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.account;
  const result = await upstream.auth.get(`/internal/users/${userId}`);
  const account = result.ok ? result.data : null;
  if (account && env.ADMIN_ROLE_CACHE_MS > 0) {
    cache.set(userId, { expiresAt: Date.now() + env.ADMIN_ROLE_CACHE_MS, account });
  }
  return account;
};

const loadAdmin = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return sendError(res, 403, 'This area is for administrators only.', 'FORBIDDEN');
    }
    const account = await lookupAccount(req.user.id);
    if (!account || account.role !== 'admin') {
      return sendError(res, 401, 'Your session is no longer valid. Please sign in again.', 'INVALID_SESSION');
    }
    if (account.isBlocked) {
      return sendError(
        res,
        403,
        'This account has been suspended. Please contact your administrator.',
        'ACCOUNT_BLOCKED',
      );
    }
    req.admin = { id: account.id, adminRole: account.adminRole || ADMIN_ROLES.SUPER };
    return next();
  } catch (error) {
    return next(error);
  }
};

// protect (signature) + admin lookup, as one middleware stack.
const requireAdmin = [protect, loadAdmin];

const allowRoles =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.admin.adminRole)
      ? next()
      : sendError(res, 403, 'Your administrator role cannot do that.', 'FORBIDDEN');

const isSuperAdmin = (req) => req.admin && req.admin.adminRole === ADMIN_ROLES.SUPER;

// Evict a cached account after an admin edits it (role change / block), so it
// takes effect on that account's next request.
const forgetAccount = (userId) => cache.delete(userId);

module.exports = { requireAdmin, allowRoles, isSuperAdmin, forgetAccount, ADMIN_ROLES, ALL_ADMINS };
