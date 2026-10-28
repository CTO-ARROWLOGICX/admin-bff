const express = require('express');
const { validate } = require('@zafabit/service-kit');
const { requireAdmin, allowRoles, ADMIN_ROLES, ALL_ADMINS } = require('../middleware/requireAdmin');
const users = require('../controllers/userController');
const catalogue = require('../controllers/catalogueController');
const apartments = require('../controllers/apartmentsController');
const operations = require('../controllers/operationsController');
const {
  listUsersQuerySchema,
  userIdParamSchema,
  updateUserSchema,
  updateStatusSchema,
  createAdminSchema,
  createMaidSchema,
} = require('../schemas/users');

const { SUPER, OPERATIONS, SUPPORT, MARKETING } = ADMIN_ROLES;
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

// --- Maid Partners ("Add Partner") -------------------------------------------
router.post('/maids', allowRoles(SUPER, OPERATIONS), validate(createMaidSchema), users.createMaid);

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

// --- Apartments (Phase 1: apartment-wise service) ----------------------------
// Bodies are validated by service-catalogue, which owns apartments; zones and
// clusters are worked out there, never edited here.
const apartmentId = validate(apartments.idSchema, 'params');
const ops = allowRoles(SUPER, OPERATIONS);
router.get('/apartments', allowRoles(SUPER, OPERATIONS, SUPPORT, MARKETING), apartments.listApartments);
router.post('/apartments', ops, apartments.createApartment);
router.get('/apartments/:id', allowRoles(SUPER, OPERATIONS, SUPPORT, MARKETING), apartmentId, apartments.getApartment);
router.put('/apartments/:id', ops, apartmentId, apartments.updateApartment);
// The on/off switch: live | paused (+ pausedUntil) | coming_soon (+ launchMonth) | requested
router.patch('/apartments/:id/status', ops, apartmentId, apartments.setApartmentStatus);
router.delete('/apartments/:id', allowRoles(SUPER), apartmentId, apartments.deleteApartment);
router.get('/apartments/:id/open-bookings', ops, apartmentId, apartments.listOpenBookings);
router.get('/zones', allowRoles(SUPER, OPERATIONS), apartments.listZones);
router.get('/apartment-requests', allowRoles(SUPER, OPERATIONS, SUPPORT, MARKETING), apartments.listApartmentRequests);
router.put(
  '/maids/:userId/apartment',
  ops,
  validate(apartments.maidIdSchema, 'params'),
  validate(apartments.maidApartmentSchema),
  apartments.assignMaidToApartment,
);

// --- Operations Center: HR manual assignment ---------------------------------
const bookingId = validate(operations.bookingIdSchema, 'params');
router.get('/operations/hr-queue', ops, operations.getHrQueue);
router.get('/operations/hr-queue/:id/maids', ops, bookingId, operations.getCandidates);
router.post(
  '/operations/hr-queue/:id/assign',
  ops,
  bookingId,
  validate(operations.assignSchema),
  operations.assignMaid,
);

module.exports = router;
