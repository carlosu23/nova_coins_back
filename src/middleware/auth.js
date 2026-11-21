const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const { User } = require('../models');

function signUserToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Sesión requerida.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findByPk(decoded.sub, {
      attributes: ['id', 'email', 'role', 'active']
    });
    if (!user) {
      return res.status(401).json({ error: 'Sesión inválida.' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'Tu cuenta se encuentra pausada.' });
    }
    req.auth = {
      sub: user.id,
      email: user.email,
      role: user.role
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}

function requireSuperAdmin(req, res, next) {
  if (req.auth?.role !== 'Super Administrador') {
    return res.status(403).json({ error: 'Acceso exclusivo para Super Administrador.' });
  }
  return next();
}

module.exports = { signUserToken, requireAuth, requireSuperAdmin };
