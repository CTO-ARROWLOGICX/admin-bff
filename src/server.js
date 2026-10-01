require('dotenv').config();
const { createLogger } = require('@zafabit/service-kit');
const { env } = require('./config/env');
const app = require('./app');

const log = createLogger('admin-bff');

// Stateless — no database to connect to or migrate.
app.listen(env.PORT, () => log.info({ port: env.PORT }, 'admin-bff listening'));
