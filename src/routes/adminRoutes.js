const express = require('express');
const { validate } = require('@zafabit/service-kit');
const { requireAdmin, allowRoles, ADMIN_ROLES, ALL_ADMINS } = require('../middleware/requireAdmin');
const users = require('../controllers/userController');
const catalogue = require('../controllers/catalogueController');
const apartments = require('../controllers/apartmentsController');
const operations = require('../controllers/operationsController');
const reviews = require('../controllers/reviewsController');
const sos = require('../controllers/sosConfigController');
const verifications = require('../controllers/verificationsController');
const incidents = require('../controllers/incidentsController');
const bookings = require('../controllers/bookingsController');
const {
  listUsersQuerySchema,
  userIdParamSchema,
  updateUserSchema,
  updateStatusSchema,
  createAdminSchema,
  createMaidSchema,
  deleteUserSchema,
  legalHoldQuerySchema,
} = require('../schemas/users');

const { SUPER, OPERATIONS, SUPPORT, MARKETING } = ADMIN_ROLES;
const router = express.Router();

// DELETE carries { reason, immediate } in the query string or the JSON body;
// gather both (body wins) so one schema validates either.
const deletionInput = (req, res, next) => {
  req.deletion = { ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  next();
};

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
  deletionInput,
  validate(deleteUserSchema, 'deletion'),
  users.deleteUser,
);
// Account deletion lifecycle: what blocks it, undo during the 30-day grace,
// and the super-admin-only legal hold record (every look is logged by auth).
router.get(
  '/users/:id/deletion-blockers',
  allowRoles(SUPER, OPERATIONS),
  validate(userIdParamSchema, 'params'),
  users.getDeletionBlockers,
);
router.post(
  '/users/:id/restore',
  allowRoles(SUPER, OPERATIONS),
  validate(userIdParamSchema, 'params'),
  users.restoreUser,
);
router.get(
  '/users/:id/legal-hold',
  allowRoles(SUPER),
  validate(userIdParamSchema, 'params'),
  validate(legalHoldQuerySchema, 'query'),
  users.getLegalHold,
);
router.get(
  '/users/:id/legal-hold/access-log',
  allowRoles(SUPER),
  validate(userIdParamSchema, 'params'),
  users.getLegalHoldAccessLog,
);
router.patch(
  '/users/:id/status',
  allowRoles(SUPER, OPERATIONS),
  validate(userIdParamSchema, 'params'),
  validate(updateStatusSchema),
  users.updateUserStatus,
);
router.get(
  '/users/:id/liveness-checks',
  allowRoles(SUPER, OPERATIONS, SUPPORT),
  validate(userIdParamSchema, 'params'),
  users.getLivenessChecks,
);
// The team lets a maid work today when her face check did not pass.
router.patch(
  '/users/:id/daily-approval',
  allowRoles(SUPER, OPERATIONS),
  validate(userIdParamSchema, 'params'),
  users.approveDailyFace,
);
router.put(
  '/users/:id/photo',
  allowRoles(SUPER, OPERATIONS),
  validate(userIdParamSchema, 'params'),
  users.uploadMaidPhoto,
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

// --- Maid partners: verification queue and deletion ---------------------------
router.get(
  '/verifications/pending',
  allowRoles(SUPER, OPERATIONS),
  validate(verifications.pendingQuerySchema, 'query'),
  verifications.listPending,
);
router.patch(
  '/verifications/:id/approve',
  allowRoles(SUPER, OPERATIONS),
  validate(verifications.verificationParamSchema, 'params'),
  validate(verifications.approveVerificationSchema),
  verifications.approveVerification,
);
router.delete(
  '/maids/:id',
  allowRoles(SUPER, OPERATIONS),
  validate(userIdParamSchema, 'params'),
  deletionInput,
  validate(deleteUserSchema, 'deletion'),
  users.deleteMaid,
);

// --- SOS incidents (Support dashboard) ---------------------------------------
// Super and Support admins see and resolve safety alerts.
router.get(
  '/incidents',
  allowRoles(SUPER, SUPPORT),
  validate(incidents.listQuerySchema, 'query'),
  incidents.listIncidents,
);
router.patch(
  '/incidents/:id/resolve',
  allowRoles(SUPER, SUPPORT),
  validate(incidents.idParamSchema, 'params'),
  incidents.resolveIncident,
);

// --- SOS emergency number (settings screen) -----------------------------------
// Everyone on the panel can see the number; only Super and Support admins change it.
router.get('/config/sos', allowRoles(...ALL_ADMINS), sos.getSosConfig);
router.put('/config/sos', allowRoles(SUPER, SUPPORT), validate(sos.sosConfigSchema), sos.updateSosConfig);

// --- Apartments (Phase 1: apartment-wise service) ----------------------------
// Bodies are validated by service-catalogue, which owns apartments, zones and
// micro zones; clusters and hotspots are worked out there, never edited here.
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
router.post('/zones', ops, apartments.createZone);
router.put('/zones/:id', ops, apartmentId, apartments.updateZone);
router.delete('/zones/:id', allowRoles(SUPER), apartmentId, apartments.deleteZone);
router.post('/zones/:id/micro-zones', ops, apartmentId, apartments.createMicroZone);
router.put('/micro-zones/:id', ops, apartmentId, apartments.updateMicroZone);
router.delete('/micro-zones/:id', ops, apartmentId, apartments.deleteMicroZone);
router.get('/hotspots', allowRoles(SUPER, OPERATIONS, SUPPORT, MARKETING), apartments.listHotspots);
router.post('/hotspots/refresh', ops, apartments.refreshHotspots);
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

// --- Booking Management ------------------------------------------------------
// The list and details are booking-engine's GET /bookings (admin token).
const bookingIdParam = validate(bookings.bookingIdSchema, 'params');
router.get('/reports/bookings', allowRoles(...ALL_ADMINS), bookings.getReport);
router.patch('/bookings/:id/retry-dispatch', ops, bookingIdParam, bookings.retryDispatch);
router.delete('/bookings/:id', allowRoles(SUPER), bookingIdParam, bookings.deleteBooking);

// --- Review & Rating ---------------------------------------------------------
// Any admin, as the monolith's restrictTo('admin') allowed.
router.get('/reviews', allowRoles(...ALL_ADMINS), reviews.listReviews);
router.get('/reports/sentiment', allowRoles(...ALL_ADMINS), reviews.sentimentReport);

module.exports = router;
