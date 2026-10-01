const express = require('express');
const { validate } = require('@zafabit/service-kit');
const { requireAdmin, allowRoles, ADMIN_ROLES, ALL_ADMINS } = require('../middleware/requireAdmin');
const users = require('../controllers/userController');
const catalogue = require('../controllers/catalogueController');
const {
  listUsersQuerySchema,
  userIdParamSchema,
  updateUserSchema,
  updateStatusSchema,
  createAdminSchema,
} = require('../schemas/users');

const { SUPER, OPERATIONS, SUPPORT } = ADMIN_ROLES;
const router = express.Router();

router.use(requireAdmin);

// --- Users (role gates match the monolith's adminRoutes.js) ------------------
// create-admin is registered before /users/:id so it never parses as an id.
router.post('/users/create-admin', allowRoles(SUPER), validate(createAdminSchema), users.createAdmin);
router.get(
  '/users',
  allowRoles(SUPER, OPERATIONS, SUPPORT),
  validate(listUsersQuerySchema, 'query'),
  users.getUsers,
);
router.put(
  '/users/:id',
  allowRoles(SUPER, OPERATIONS),
  validate(userIdParamSchema, 'params'),
  validate(updateUserSchema),
  users.updateUser,
);
router.delete(
  '/users/:id',
  allowRoles(SUPER, OPERATIONS),
  validate(userIdParamSchema, 'params'),
  users.deleteUser,
);
router.patch(
  '/users/:id/status',
  allowRoles(SUPER, OPERATIONS),
  validate(userIdParamSchema, 'params'),
  validate(updateStatusSchema),
  users.updateUserStatus,
);

// --- Service catalogue (panel's /api/v1/services -> /admin/shared/services) ---
// Any admin, as the monolith's restrictTo('admin') allowed. Bodies (JSON or
// multipart) are validated by service-catalogue, which owns the contract.
const serviceId = validate(catalogue.serviceIdSchema, 'params');
router.get('/shared/services', allowRoles(...ALL_ADMINS), catalogue.listServices);
router.get('/shared/services/:id', allowRoles(...ALL_ADMINS), serviceId, catalogue.getService);
router.post('/shared/services', allowRoles(...ALL_ADMINS), catalogue.createService);
router.put('/shared/services/:id', allowRoles(...ALL_ADMINS), serviceId, catalogue.updateService);
router.delete('/shared/services/:id', allowRoles(...ALL_ADMINS), serviceId, catalogue.deleteService);

// --- Booking config (settings screen) ----------------------------------------
router.get('/config/booking', allowRoles(SUPER, OPERATIONS), catalogue.getBookingConfig);
router.put('/config/booking', allowRoles(SUPER, OPERATIONS), catalogue.updateBookingConfig);

module.exports = router;
