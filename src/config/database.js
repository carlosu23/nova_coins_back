const { Client } = require('pg');
const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

const dbUrl = String(process.env.DB_URL || '').trim();

if (!dbUrl) {
  logger.error('DB_URL no configurada. Define DB_URL en el archivo .env (ej: postgres://usuario:clave@host:5432/nova).');
  process.exit(1);
}

const parsedUrl = new URL(dbUrl);
const sslParam = parsedUrl.searchParams.get('sslmode');
const useSsl = process.env.DB_SSL === 'true' || sslParam === 'require' || sslParam === 'verify-full';

const dialectOptions = useSsl
  ? {
      ssl: {
        require: true,
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
      }
    }
  : undefined;

async function ensureDatabaseExists() {
  const isLocalHost = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
  if (!isLocalHost) {
    return;
  }

  const dbName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));
  if (!dbName) {
    return;
  }

  const adminUrl = new URL(dbUrl);
  adminUrl.pathname = '/postgres';

  const client = new Client({
    connectionString: adminUrl.toString(),
    ...(useSsl ? { ssl: dialectOptions.ssl } : {})
  });

  try {
    await client.connect();
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (res.rowCount === 0) {
      const safeName = dbName.replace(/"/g, '""');
      await client.query(`CREATE DATABASE "${safeName}"`);
      logger.info(`Base de datos ${dbName} creada.`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

const sequelize = new Sequelize(dbUrl, {
  dialect: 'postgres',
  logging: false,
  dialectOptions
});

module.exports = { sequelize, ensureDatabaseExists };
