const logger = require('../utils/logger');

const IS_PROD = process.env.NODE_ENV === 'production';
const INSECURE_DEFAULTS = new Set([
  '',
  'novacoins_ec_jwt_secret_2026',
  'changeme',
  'secret',
  'your_jwt_secret_here'
]);

const rawSecret = String(process.env.JWT_SECRET || '').trim();

if (IS_PROD && (INSECURE_DEFAULTS.has(rawSecret) || rawSecret.length < 16)) {
  logger.error(
    'JWT_SECRET inválido o ausente en producción. Define una clave segura de al menos 16 caracteres.'
  );
  process.exit(1);
}

const JWT_SECRET = rawSecret || 'dev_only_novacoins_secret_change_me';
if (!IS_PROD && (!rawSecret || INSECURE_DEFAULTS.has(rawSecret))) {
  logger.warn('Usando JWT_SECRET de desarrollo. Configura un valor seguro antes de pasar a producción.');
}

function parseOriginList(raw) {
  const list = String(raw || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const expanded = [];
  for (const origin of list) {
    expanded.push(origin);
    try {
      const url = new URL(origin);
      if (url.hostname.startsWith('www.')) {
        expanded.push(`${url.protocol}//${url.hostname.slice(4)}${url.port ? `:${url.port}` : ''}`);
      } else if (!url.hostname.includes('localhost') && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
        expanded.push(`${url.protocol}//www.${url.hostname}${url.port ? `:${url.port}` : ''}`);
      }
    } catch {
      expanded.push(origin);
    }
  }
  return expanded;
}

const allowedOrigins = Array.from(
  new Set([
    ...parseOriginList(process.env.FRONT_URL),
    ...parseOriginList(process.env.ADMIN_URL),
    ...parseOriginList(process.env.CORS_ORIGINS)
  ])
);

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }
  if (allowedOrigins.includes('*')) {
    return true;
  }
  if (allowedOrigins.length === 0) {
    return !IS_PROD;
  }
  const normalized = String(origin).trim().replace(/\/+$/, '');
  return allowedOrigins.includes(normalized);
}

module.exports = {
  IS_PROD,
  JWT_SECRET,
  allowedOrigins,
  isOriginAllowed
};
