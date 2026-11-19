const { createLogger } = require('./logger');

// Session revocation. When an account is suspended, auth records the moment
// in Redis; every token issued before that moment is refused on its next use.
// The store is shared by all services (REDIS_URL). Without it, revocation is
// off and suspension only stops new sign-ins.

const log = createLogger('service-kit:revocation');
const KEY_PREFIX = 'revoked_before:';
// Longer than the longest token (30 days), so a record outlives every token it covers.
const TTL_SECONDS = 31 * 24 * 60 * 60;

let store = null;
let warnedDisabled = false;

const redisStore = () => {
  const { createClient } = require('redis');
  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (err) => log.error({ err: err.message }, 'redis error'));
  const ready = client.connect();
  ready.catch(() => {});
  return {
    get: async (key) => {
      await ready;
      return client.get(key);
    },
    set: async (key, value, ttl) => {
      await ready;
      return client.set(key, value, { EX: ttl });
    },
  };
};

const getStore = () => {
  if (store) return store;
  if (!process.env.REDIS_URL) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      log.warn('REDIS_URL is not set: session revocation is disabled');
    }
    return null;
  }
  store = redisStore();
  return store;
};

/** Seconds since epoch before which tokens for this user are refused, or null. */
const sessionsRevokedBefore = async (userId) => {
  const s = getStore();
  if (!s) return null;
  try {
    const value = await s.get(KEY_PREFIX + userId);
    return value ? Number(value) : null;
  } catch (err) {
    // Fail open: a Redis outage must not take the whole platform down. The
    // error is logged so it can be investigated.
    log.error({ err: err.message }, 'could not read session revocation; allowing the token');
    return null;
  }
};

/** Refuses every token issued up to now for this user. Returns true when recorded. */
const revokeSessions = async (userId, now = Date.now()) => {
  const s = getStore();
  if (!s) {
    log.error({ userId }, 'could not revoke sessions: REDIS_URL is not set');
    return false;
  }
  // +1 second: a token issued in this same second is revoked too.
  const at = Math.floor(now / 1000) + 1;
  await s.set(KEY_PREFIX + userId, String(at), TTL_SECONDS);
  return true;
};

// Test hook: inject an in-memory store.
const _setStore = (injected) => {
  store = injected;
};

module.exports = { sessionsRevokedBefore, revokeSessions, TTL_SECONDS, _setStore };
