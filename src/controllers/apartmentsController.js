const { z, schemas } = require('@zafabit/service-kit');
const upstream = require('../utils/upstream');
const { relay } = require('../utils/relay');

// /admin/apartments/*, /admin/zones, /admin/apartment-requests — the
// Apartments page (Phase 1, apartment-wise service). service-catalogue owns
// apartments and validates their bodies; maid-service owns which maid is
// stationed where; booking-engine owns the bookings at each apartment.

const idSchema = z.object({ id: schemas.uuid });
const maidIdSchema = z.object({ userId: schemas.uuid });
const maidApartmentSchema = z.object({ apartmentId: schemas.uuid.nullable() });

const forwardTo = (pathOf) => async (req, res, next) => {
  try {
    return relay(res, await upstream.catalogue.forward(pathOf(req), req));
  } catch (error) {
    return next(error);
  }
};

/**
 * @route GET /admin/apartments   query: page, limit, search, status, city
 * The Apartments page: each apartment with its towers, status and how many
 * maids are stationed there. A maid-service hiccup shows counts as null
 * rather than failing the page.
 */
const listApartments = async (req, res, next) => {
  try {
    const [list, counts] = await Promise.all([
      upstream.catalogue.forward('/internal/admin/apartments', req),
      upstream.maid.get('/internal/maids/apartment-counts').catch(() => null),
    ]);
    if (!list.ok) return relay(res, list);
    const byApartment = counts && counts.ok && counts.data ? counts.data.counts || {} : null;
    const apartments = (list.data.apartments || []).map((a) => ({
      ...a,
      towerCount: Array.isArray(a.towers) ? a.towers.length : 0,
      maidsAssigned: byApartment ? byApartment[a.id] || 0 : null,
    }));
    return relay(res, { ...list, data: { ...list.data, apartments } });
  } catch (error) {
    return next(error);
  }
};

/**
 * @route GET /admin/apartments/:id/open-bookings
 * Bookings still open at an apartment — what the team reviews when it is
 * switched off (keep them, or cancel and refund via POST /bookings/:id/cancel
 * with the admin token).
 */
const listOpenBookings = async (req, res, next) => {
  try {
    return relay(res, await upstream.booking.get('/internal/bookings', { apartmentId: req.params.id }));
  } catch (error) {
    return next(error);
  }
};

/**
 * @route PUT /admin/maids/:userId/apartment   body: { apartmentId | null }
 * Stations a maid at an apartment (or unassigns her). The apartment is
 * checked with service-catalogue first.
 */
const assignMaidToApartment = async (req, res, next) => {
  try {
    const { apartmentId } = req.validated;
    if (apartmentId) {
      const found = await upstream.catalogue.get(`/internal/apartments/${apartmentId}`);
      if (!found.ok) return relay(res, found);
    }
    return relay(res, await upstream.maid.put(`/internal/maids/${req.params.userId}/apartment`, { apartmentId }));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  idSchema,
  maidIdSchema,
  maidApartmentSchema,
  listApartments,
  getApartment: forwardTo((req) => `/internal/admin/apartments/${req.params.id}`),
  createApartment: forwardTo(() => '/internal/admin/apartments'),
  updateApartment: forwardTo((req) => `/internal/admin/apartments/${req.params.id}`),
  setApartmentStatus: forwardTo((req) => `/internal/admin/apartments/${req.params.id}/status`),
  deleteApartment: forwardTo((req) => `/internal/admin/apartments/${req.params.id}`),
  listZones: forwardTo(() => '/internal/admin/zones'),
  listApartmentRequests: forwardTo(() => '/internal/admin/apartment-requests'),
  listOpenBookings,
  assignMaidToApartment,
};
