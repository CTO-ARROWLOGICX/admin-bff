const { createLogger } = require('@zafabit/service-kit');
const { env } = require('../config/env');

// Service-to-service client for the owning services' /internal/* APIs.
//
// Unlike auth's fire-and-forget client, admin writes must surface the
// owner's verdict (409 EMAIL_TAKEN, 404, validation errors) to the panel, so
// a non-2xx response is returned as-is and only a transport failure (refused,
// timeout, non-JSON) throws an UpstreamError — rendered as a 502 by the error
// handler, never leaking the internal host.
const log = createLogger('admin-bff:upstream');

class UpstreamError extends Error {
  constructor(service, method, pathname, cause) {
    super(`${service} unavailable`);
    this.name = 'UpstreamError';
    this.service = service;
    this.method = method;
    this.pathname = pathname;
    this.cause = cause;
  }
}

const BASES = {
  auth: env.AUTH_SERVICE_URL,
  'identity-profiles': env.IDENTITY_PROFILES_SERVICE_URL,
};

/**
 * @returns {Promise<{ ok, status, data, message, error }>}
 */
const call = async (service, method, pathname, { body, query } = {}) => {
  const base = BASES[service];
  if (!base) throw new Error(`unknown upstream service "${service}"`);
  const url = new URL(base.replace(/\/+$/, '') + pathname);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  let res;
  let json;
  try {
    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-internal-key': env.INTERNAL_API_KEY || '' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(env.INTERNAL_HTTP_TIMEOUT_MS),
    });
    json = await res.json();
  } catch (err) {
    log.warn({ service, method, pathname, err: err && err.name }, 'upstream call failed');
    throw new UpstreamError(service, method, pathname, err);
  }

  if (!res.ok) log.warn({ service, method, pathname, status: res.status }, 'upstream non-2xx');
  return {
    ok: res.ok,
    status: res.status,
    data: json && typeof json === 'object' ? (json.data ?? null) : null,
    message: (json && json.message) || null,
    error: (json && json.error) || null,
  };
};

const client = (service) => ({
  get: (pathname, query) => call(service, 'GET', pathname, { query }),
  post: (pathname, body) => call(service, 'POST', pathname, { body }),
  put: (pathname, body) => call(service, 'PUT', pathname, { body }),
  patch: (pathname, body) => call(service, 'PATCH', pathname, { body }),
  del: (pathname) => call(service, 'DELETE', pathname),
});

module.exports = {
  auth: client('auth'),
  identity: client('identity-profiles'),
  UpstreamError,
};
