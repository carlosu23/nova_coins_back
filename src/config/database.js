const { Client } = require('pg');
const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = Number(process.env.DB_PORT || 5432);
const dbName = process.env.DB_NAME || 'novacoins';
const dbUser = process.env.DB_USER || 'postgres';
const dbPass = process.env.DB_PASS || '';
const useSsl = process.env.DB_SSL === 'true';

const dialectOptions = useSsl
  ? {
      ssl: {
        require: true,
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
      }
    }
  : undefined;

async function ensureDatabaseExists() {
  if (process.env.DATABASE_URL) {
    return;
  }

  const client = new Client({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPass,
    database: 'postgres',
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

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: false,
      dialectOptions
    })
  : new Sequelize(dbName, dbUser, dbPass, {
      host: dbHost,
      port: dbPort,
      dialect: 'postgres',
      logging: false,
      dialectOptions
    });

module.exports = { sequelize, ensureDatabaseExists };
