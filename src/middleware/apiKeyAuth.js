const crypto = require('node:crypto');
const { ApiKey, User } = require('../models');

function hashApiKey(plainKey) {
  return crypto.createHash('sha256').update(String(plainKey || '')).digest('hex');
}

function generatePlainApiKey(environment = 'production') {
  const prefix = environment === 'sandbox' ? 'nc_test_' : 'nc_live_';
  return `${prefix}${crypto.randomBytes(24).toString('hex')}`;
}

async function requireApiKey(req, res, next) {
  const authHeader = String(req.headers.authorization || '').trim();
  const xApiKey = String(req.headers['x-api-key'] || '').trim();
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : xApiKey;

  if (!token || (!token.startsWith('nc_live_') && !token.startsWith('nc_test_'))) {
    return res.status(401).json({
      error: { code: 'invalid_api_key', message: 'API key ausente o con formato inválido.' }
    });
  }

  try {
    const keyHash = hashApiKey(token);
    const apiKey = await ApiKey.findOne({
      where: { keyHash },
      include: [{ model: User, as: 'user', attributes: ['id', 'email', 'role', 'active'] }]
    });

    if (!apiKey || !apiKey.active || apiKey.revokedAt || !apiKey.user || !apiKey.user.active) {
      return res.status(401).json({
        error: { code: 'invalid_api_key', message: 'API key inválida, revocada o cuenta inactiva.' }
      });
    }

    if (apiKey.allowedIps) {
      const allowed = apiKey.allowedIps
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean);
      const clientIp = req.ip || req.socket?.remoteAddress || '';
      if (allowed.length > 0 && !allowed.includes(clientIp)) {
        return res.status(403).json({
          error: { code: 'ip_not_allowed', message: 'IP no autorizada para esta API key.', ip: clientIp }
        });
      }
    }

    const grantedScopes = new Set(
      String(apiKey.scopes || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );

    req.apiKeyAuth = {
      apiKeyId: apiKey.id,
      userId: apiKey.user.id,
      email: apiKey.user.email,
      role: apiKey.user.role,
      environment: apiKey.environment === 'sandbox' ? 'sandbox' : 'production',
      scopes: grantedScopes
    };

    apiKey
      .update({
        lastUsedAt: new Date(),
        lastUsedIp: req.ip || req.socket?.remoteAddress || null
      })
      .catch(() => {});

    return next();
  } catch {
    return res.status(500).json({
      error: { code: 'internal_error', message: 'Error verificando API key.' }
    });
  }
}

function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKeyAuth?.scopes?.has(scope)) {
      return res.status(403).json({
        error: {
          code: 'insufficient_scope',
          message: `La API key no tiene el permiso requerido: ${scope}.`
        }
      });
    }
    return next();
  };
}

module.exports = {
  hashApiKey,
  generatePlainApiKey,
  requireApiKey,
  requireScope
};
