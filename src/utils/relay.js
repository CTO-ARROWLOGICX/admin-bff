const { sendResponse, sendError } = require('@zafabit/service-kit');

// Sends an owning service's answer (from utils/upstream.js) back to the panel
// unchanged: data + pagination on success, message + code + details on error.
const relay = (res, result) =>
  result.ok
    ? sendResponse(
        res,
        result.status,
        result.message,
        result.data,
        result.meta && result.meta.pagination ? { pagination: result.meta.pagination } : {},
      )
    : sendError(
        res,
        result.status,
        result.message || 'We were unable to complete your request.',
        (result.error && result.error.code) || 'UPSTREAM_ERROR',
        (result.error && result.error.details) || [],
      );

module.exports = { relay };
