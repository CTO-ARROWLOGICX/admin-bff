const { z } = require('@zafabit/service-kit');
const upstream = require('../utils/upstream');
const { relay } = require('../utils/relay');

// /admin/shared/services/* (the panel's /api/v1/services) and
// /admin/config/booking — service-catalogue owns the data and the request
// contract (validation, multipart images), so these relay the admin's request
// and service-catalogue's answer unchanged.

// Validated here only so a junk id can't be spliced into the upstream path.
const serviceIdSchema = z.object({
  id: z.string().regex(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24})$/i,
    'A valid service id is required.',
  ),
});

const forwardTo = (pathOf) => async (req, res, next) => {
  try {
    return relay(res, await upstream.catalogue.forward(pathOf(req), req));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  serviceIdSchema,
  listServices: forwardTo(() => '/internal/admin/services'),
  getService: forwardTo((req) => `/internal/admin/services/${req.params.id}`),
  createService: forwardTo(() => '/internal/admin/services'),
  updateService: forwardTo((req) => `/internal/admin/services/${req.params.id}`),
  deleteService: forwardTo((req) => `/internal/admin/services/${req.params.id}`),
  getBookingConfig: forwardTo(() => '/internal/booking-config'),
  updateBookingConfig: forwardTo(() => '/internal/booking-config'),
};
