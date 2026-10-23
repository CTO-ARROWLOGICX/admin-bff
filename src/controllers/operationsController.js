const { z, schemas } = require('@zafabit/service-kit');
const upstream = require('../utils/upstream');
const { relay } = require('../utils/relay');

// /admin/operations/* — the Operations Center's HR assignment queue. A
// booking no maid accepted within 5 minutes lands here (booking-engine moves
// it); HR picks a maid on shift in its region and assigns her directly.

const bookingIdSchema = z.object({ id: schemas.uuid });
const assignSchema = z.object({ maidId: schemas.uuid });

const relayFrom = (call) => async (req, res, next) => {
  try {
    return relay(res, await call(req));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  bookingIdSchema,
  assignSchema,
  // GET /admin/operations/hr-queue
  getHrQueue: relayFrom(() => upstream.booking.get('/internal/bookings/hr-queue')),
  // GET /admin/operations/hr-queue/:id/maids — free maids in the region, busy ones with when they finish
  getCandidates: relayFrom((req) => upstream.booking.get(`/internal/bookings/${req.params.id}/candidates`)),
  // POST /admin/operations/hr-queue/:id/assign   body: { maidId }
  assignMaid: relayFrom((req) =>
    upstream.booking.patch(`/internal/bookings/${req.params.id}/assign`, { maidId: req.validated.maidId, direct: true }),
  ),
};
