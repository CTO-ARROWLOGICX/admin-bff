const upstream = require('../utils/upstream');
const { relay } = require('../utils/relay');

// The panel's Review & Rating page. Reviews live in booking-engine, beside the
// bookings they rate; it validates the query and fills in the people.

const relayFrom = (call) => async (req, res, next) => {
  try {
    return relay(res, await call(req));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  // GET /admin/reviews?sentiment=&page=&limit=  (the panel's /reviews/admin, via the gateway)
  listReviews: relayFrom((req) => upstream.booking.get('/internal/reviews', req.query)),
  // GET /admin/reports/sentiment
  sentimentReport: relayFrom(() => upstream.booking.get('/internal/reviews/sentiment')),
};
