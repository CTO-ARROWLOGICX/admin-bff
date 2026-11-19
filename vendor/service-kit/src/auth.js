const { verifyToken } = require('./jwt');
const { sendError } = require('./response');
const { sessionsRevokedBefore } = require('./revocation');

// Bearer-token guard. Verifies the signature, then checks the account has not
// been suspended since the token was issued (see revocation.js). No database
// round-trip: the revocation check is one Redis read.
const protect = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return sendError(res, 401, 'Please sign in to continue.', 'NOT_AUTHENTICATED');
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    const expired = err && err.name === 'TokenExpiredError';
    return sendError(
      res,
      401,
      expired
        ? 'Your session has expired. Please sign in again.'
        : 'Your session is no longer valid. Please sign in again.',
      expired ? 'SESSION_EXPIRED' : 'INVALID_SESSION',
    );
  }

  const revokedBefore = await sessionsRevokedBefore(payload.id);
  if (revokedBefore && payload.iat && payload.iat < revokedBefore) {
    return sendError(
      res,
      401,
      'Your session is no longer valid. Please sign in again.',
      'SESSION_REVOKED',
    );
  }

  req.user = { id: payload.id, role: payload.role, phone: payload.phone || null };
  return next();
};

module.exports = { protect };
