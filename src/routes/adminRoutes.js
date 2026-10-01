const express = require('express');
const { validate } = require('@zafabit/service-kit');
const { requireAdmin, allowRoles, ADMIN_ROLES } = require('../middleware/requireAdmin');
const users = require('../controllers/userController');
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

module.exports = router;
