const express = require('express');
const {
  applySecurity,
  httpLogger,
  notFound,
  makeErrorHandler,
  sendResponse,
  sendError,
} = require('@zafabit/service-kit');
const { UpstreamError } = require('./utils/upstream');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

app.set('trust proxy', 1);
applySecurity(app);
app.use(express.json({ limit: '100kb' }));
app.use(httpLogger('admin-bff'));

app.get('/health', (req, res) =>
  sendResponse(res, 200, 'Admin BFF is running.', { service: 'admin-bff', version: '0.1.0' }),
);

// The gateway strips its `/admin` mount prefix, so routes are mounted at `/`.
app.use('/', adminRoutes);

app.use(notFound);
// An owning service didn't answer — say so (502) rather than a generic 500.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (!(err instanceof UpstreamError)) return next(err);
  if (req.log) req.log.error({ service: err.service, path: err.pathname }, 'upstream unavailable');
  return sendError(
    res,
    502,
    'That information is temporarily unavailable. Please try again shortly.',
    'UPSTREAM_UNAVAILABLE',
  );
});
app.use(makeErrorHandler());

module.exports = app;
