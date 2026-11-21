const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

if (process.env.NODE_ENV) {
  const modeEnvPath = path.resolve(__dirname, `.env.${process.env.NODE_ENV}`);
  if (fs.existsSync(modeEnvPath)) {
    dotenv.config({ path: modeEnvPath });
  }
}
dotenv.config({ path: path.resolve(__dirname, '.env') });
const http = require('node:http');
const express = require('express');
const morgan = require('morgan');
const { ensureDatabaseExists, sequelize } = require('./src/config/database');
const { IS_PROD, isOriginAllowed } = require('./src/config/env');
const { registerDatabaseRealtimeHooks } = require('./src/realtime/dbEvents');
const { initSocketServer } = require('./src/realtime/socket');
const adminRoutes = require('./src/routes/admin.routes');
const authRoutes = require('./src/routes/auth.routes');
const publicApiV1Routes = require('./src/routes/publicApiV1.routes');
const webhookRoutes = require('./src/routes/webhooks.routes');
const { seedAdminData } = require('./src/seed/seedAdminData');
const { seedInitialSuperAdmin } = require('./src/seed/seedUsers');
const logger = require('./src/utils/logger');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 4000);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

app.use('/api/webhooks', webhookRoutes);
app.use(express.json({ limit: '2mb' }));
app.use(morgan(IS_PROD ? 'combined' : 'dev'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'novacoins-api' });
});

app.use('/api/v1', publicApiV1Routes);
app.use('/api', authRoutes);
app.use('/api/admin', adminRoutes);

async function bootstrap() {
  try {
    await ensureDatabaseExists();
    await sequelize.authenticate();
    const shouldAlter = process.env.DB_SYNC_ALTER === 'true' || !IS_PROD;
    await sequelize.sync(shouldAlter ? { alter: true } : undefined);
    await seedInitialSuperAdmin();
    await seedAdminData();
    registerDatabaseRealtimeHooks();
    initSocketServer(server);
    server.listen(PORT, () => {
      logger.info(`Nova Coins API + Socket.IO escuchando en puerto ${PORT} (${IS_PROD ? 'producción' : 'desarrollo'})`);
    });
  } catch (err) {
    logger.error(`Error al iniciar API: ${err.message}`);
    process.exit(1);
  }
}

function shutdown(signal) {
  logger.info(`Señal ${signal} recibida. Cerrando servidor...`);
  server.close(async () => {
    await sequelize.close().catch(() => {});
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap();
