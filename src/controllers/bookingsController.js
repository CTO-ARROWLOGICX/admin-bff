const { z, schemas } = require('@zafabit/service-kit');
const upstream = require('../utils/upstream');
const { relay } = require('../utils/relay');

// /admin/bookings/* and /admin/reports/bookings — the Booking Management
// page's admin-only actions. The list and details come straight from
// booking-engine's public GET /bookings (an admin token sees every booking).

const bookingIdSchema = z.object({ id: schemas.uuid });

const relayFrom = (call) => async (req, res, next) => {
  try {
    return relay(res, await call(req));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  bookingIdSchema,
  // GET /admin/reports/bookings — KPI cards
  getReport: relayFrom(() => upstream.booking.get('/internal/bookings/admin/report')),
  // PATCH /admin/bookings/:id/retry-dispatch — offer a waiting booking to maids again
  retryDispatch: relayFrom((req) => upstream.booking.patch(`/internal/bookings/admin/${req.params.id}/retry-dispatch`, {})),
  // DELETE /admin/bookings/:id — unpaid, not-started bookings only (booking-engine checks)
  deleteBooking: relayFrom((req) => upstream.booking.del(`/internal/bookings/admin/${req.params.id}`)),
};
