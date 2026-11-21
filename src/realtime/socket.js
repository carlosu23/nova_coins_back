const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { JWT_SECRET, isOriginAllowed } = require('../config/env');
const { ProductMargin, User } = require('../models');
const logger = require('../utils/logger');
const { buildAdminSnapshot, buildPublicCatalog, buildUserPayload } = require('../utils/userPayload');

let ioInstance = null;

function initSocketServer(httpServer) {
  ioInstance = new Server(httpServer, {
    transports: ['websocket'],
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          return callback(null, true);
        }
        return callback(new Error('Origen no permitido por CORS.'));
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
    }
  });

  ioInstance.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next();
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findByPk(decoded.sub, {
        attributes: ['id', 'role', 'active']
      });
      if (user && user.active) {
        socket.data.auth = { sub: user.id, role: user.role };
      } else {
        socket.data.auth = null;
      }
    } catch {
      socket.data.auth = null;
    }
    return next();
  });

  ioInstance.on('connection', async (socket) => {
    const auth = socket.data.auth;
    if (auth?.sub) {
      socket.join(`user:${auth.sub}`);
    }
    if (auth?.role === 'Super Administrador') {
      socket.join('superadmin');
      try {
        const snapshot = await buildAdminSnapshot();
        socket.emit('admin:snapshot', snapshot);
      } catch (err) {
        logger.error(`Error enviando snapshot inicial: ${err.message}`);
      }
    }
  });

  return ioInstance;
}

function emitToSuperAdmin(eventName, payload) {
  if (!ioInstance) {
    return;
  }
  ioInstance.to('superadmin').emit(eventName, payload);
}

function emitToAll(eventName, payload) {
  if (!ioInstance) {
    return;
  }
  ioInstance.emit(eventName, payload);
}

async function emitUserUpdate(userId) {
  if (!ioInstance || !userId) {
    return;
  }
  const user = await buildUserPayload(userId);
  if (user) {
    ioInstance.to(`user:${userId}`).emit('user:updated', { user });
  }
}

async function emitAdminSnapshot() {
  if (!ioInstance) {
    return;
  }
  const snapshot = await buildAdminSnapshot();
  ioInstance.to('superadmin').emit('admin:snapshot', snapshot);
}

async function emitCatalogMargins() {
  if (!ioInstance) {
    return;
  }
  const [margins, catalog] = await Promise.all([
    ProductMargin.findAll({ where: { active: true } }),
    buildPublicCatalog()
  ]);
  const payload = margins.map((m) => ({
    id: m.id,
    publicPriceUsd: Number(m.publicPriceUsd),
    resellerPriceUsd: Number(m.resellerPriceUsd)
  }));
  ioInstance.emit('catalog:margins', { margins: payload });
  ioInstance.emit('catalog:updated', { games: catalog });
}

module.exports = {
  initSocketServer,
  emitToSuperAdmin,
  emitToAll,
  emitUserUpdate,
  emitAdminSnapshot,
  emitCatalogMargins
};
