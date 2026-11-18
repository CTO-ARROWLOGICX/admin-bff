const { z } = require('@zafabit/service-kit');
const upstream = require('../utils/upstream');
const { relay } = require('../utils/relay');

// The SOS emergency number the apps dial. Stored by support-trust; this
// controller validates the panel's input and records which admin changed it.
const PHONE_RE = /^\+?[0-9][0-9 -]{5,18}[0-9]$/;

const sosConfigSchema = z.object({
  emergencyNumber: z
    .string()
    .trim()
    .regex(PHONE_RE, 'Enter a valid emergency phone number, e.g. +91 00000 00000.'),
});

const getSosConfig = async (req, res, next) => {
  try {
    return relay(res, await upstream.support.get('/internal/sos-config'));
  } catch (error) {
    return next(error);
  }
};

const updateSosConfig = async (req, res, next) => {
  try {
    return relay(
      res,
      await upstream.support.put('/internal/sos-config', {
        emergencyNumber: req.validated.emergencyNumber,
        updatedBy: req.admin.id,
      }),
    );
  } catch (error) {
    return next(error);
  }
};

module.exports = { sosConfigSchema, getSosConfig, updateSosConfig };
