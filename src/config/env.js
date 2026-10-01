const { loadEnv, z, port } = require('@zafabit/service-kit');

const prod = process.env.NODE_ENV === 'production';
const secret = prod ? z.string().min(1) : z.string().min(1).optional();
const serviceUrl = (def) => z.string().url().default(def);

const env = loadEnv(
  {
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: port(4012),
    LOG_LEVEL: z.string().optional(),

    JWT_SECRET: secret,
    // Outside production, default to the key every service's internalAuth
    // accepts in dev — this service only ever *sends* it.
    INTERNAL_API_KEY: prod ? secret : z.string().min(1).default('zafabit_dev_internal_key'),
    INTERNAL_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
    ADMIN_ROLE_CACHE_MS: z.coerce.number().int().nonnegative().default(30_000),

    CORS_ORIGINS: z.string().optional(),

    AUTH_SERVICE_URL: serviceUrl('http://localhost:4001'),
    IDENTITY_PROFILES_SERVICE_URL: serviceUrl('http://localhost:4002'),
    SERVICE_CATALOGUE_SERVICE_URL: serviceUrl('http://localhost:4004'),
  },
  { name: 'admin-bff' },
);

module.exports = { env };
