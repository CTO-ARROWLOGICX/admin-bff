const { z, schemas } = require('@zafabit/service-kit');
const { ALL_ADMINS } = require('../middleware/requireAdmin');

// The panel sends filters straight from its dropdowns — '' and 'all' mean
// "no filter", so drop them before validating.
const filter = (inner) =>
  z.preprocess((v) => (v === '' || v === 'all' || v == null ? undefined : v), inner.optional());

const listUsersQuerySchema = z.object({
  role: filter(schemas.oneOf(['customer', 'maid', 'admin', 'agent'], 'Role')),
  status: filter(schemas.oneOf(['active', 'inactive', 'blocked'], 'Status')),
  filterType: filter(schemas.oneOf(['new', 'active', 'inactive', 'blocked'], 'Filter')),
  search: filter(z.string().trim().max(100)),
  location: filter(z.string().trim().max(100)),
  propertyType: filter(z.string().trim().max(50)),
  memberCount: filter(z.coerce.number().int().min(0).max(100)),
  page: z.coerce.number().int().positive().catch(1).default(1),
  limit: z.coerce.number().int().positive().max(100).catch(10).default(10),
});

const userIdParamSchema = z.object({ id: schemas.uuid });

const name = (label) => z.string().trim().max(100, `${label} must be 100 characters or fewer.`);

const updateUserSchema = z.object({
  name: name('Name').optional(),
  firstName: name('First name').optional(),
  lastName: name('Last name').optional(),
  email: z.string().trim().max(255).email('Enter a valid email address.').optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  location: z.string().trim().max(100).optional(),
  adminRole: schemas.oneOf(ALL_ADMINS, 'Admin role').optional(),
  // The panel sends '' when the password box is left empty — no change.
  password: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().min(8, 'Password must be at least 8 characters.').max(128).optional(),
  ),
  // Maid accounts only — owned by maid-service, which validates the values.
  zone: z.string().trim().max(100).nullable().optional(),
  jobType: z.string().trim().max(30).nullable().optional(),
  language: z.string().trim().max(10).optional(),
  activeStatus: z.string().trim().max(30).optional(),
  isIdentityVerified: z.boolean().optional(),
});

const updateStatusSchema = z.object({
  activeStatus: z.string().trim().max(30).optional(),
  isIdentityVerified: z.boolean().optional(),
  isBlocked: z.boolean().optional(),
});

const createAdminSchema = z.object({
  firstName: name('First name').min(1, 'First name is required.'),
  lastName: name('Last name').optional(),
  email: z.string().trim().max(255).email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  phone: z.string().trim().max(20).optional(),
  // Unknown roles fall back to operations_admin, as the monolith did.
  adminRole: z.preprocess(
    (v) => (typeof v === 'string' && ALL_ADMINS.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : undefined),
    z.enum(ALL_ADMINS).default('operations_admin'),
  ),
});

// POST /admin/maids — the panel's "Add Service Partner" form. Its rating,
// completedJobs and totalEarnings boxes are dropped: those are earned through
// bookings, never typed in. Zone … activeStatus are validated by maid-service.
const createMaidSchema = z.object({
  name: name('Name').min(1, 'Name is required.'),
  email: z.string().trim().max(255).email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  phone: z.string().trim().min(1, 'Phone number is required.').max(20),
  zone: z.string().trim().min(1, 'Zone is required.').max(100),
  jobType: z.string().trim().max(30).nullable().optional(),
  language: z.string().trim().max(10).default('en'),
  activeStatus: z.string().trim().max(30).default('inactive'),
  isIdentityVerified: z.boolean().default(true),
});

module.exports = {
  listUsersQuerySchema,
  userIdParamSchema,
  updateUserSchema,
  updateStatusSchema,
  createAdminSchema,
  createMaidSchema,
};
