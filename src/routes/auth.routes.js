const express = require('express');
const { sequelize } = require('../config/database');
const { IS_PROD } = require('../config/env');
const { requireAuth, signUserToken } = require('../middleware/auth');
const { generatePlainApiKey, hashApiKey } = require('../middleware/apiKeyAuth');
const { createRateLimiter } = require('../middleware/rateLimit');
const {
  ApiKey,
  Order,
  PaymentChannel,
  ProductMargin,
  ResellerApplication,
  SavedId,
  User
} = require('../models');
const { fulfillOrderWithPool, validatePlayerWithPool } = require('../providers/supplierPool');
const logger = require('../utils/logger');
const { hashPassword, verifyPassword } = require('../utils/password');
const { generateOrderCode } = require('../utils/orderCode');
const { extractTargetFieldsFromPayload } = require('../utils/supplierNormalizer');
const { buildPublicCatalog, buildPublicHeroBanners, buildUserPayload, formatPublicChannel } = require('../utils/userPayload');

const router = express.Router();

const authLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 15,
  message: 'Demasiados intentos de acceso. Espera un minuto.'
});

const applicationLimiter = createRateLimiter({
  windowMs: 10 * 60_000,
  max: 10,
  message: 'Has enviado demasiadas solicitudes recientes. Intenta más tarde.'
});

const validatePlayerLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 25,
  message: 'Límite de validaciones alcanzado. Espera un minuto.'
});

function handleServerError(res, err, fallbackMessage) {
  logger.error(`${fallbackMessage}: ${err.message}`);
  return res.status(500).json({ error: IS_PROD ? fallbackMessage : err.message || fallbackMessage });
}

function sanitizeProofImage(raw) {
  if (!raw) {
    return null;
  }
  const value = String(raw).trim();
  if (!value) {
    return null;
  }
  const isDataImage = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value);
  const isHttpsUrl = /^https:\/\/.+/i.test(value);
  if (!isDataImage && !isHttpsUrl) {
    return null;
  }
  if (value.length > 1_600_000) {
    return null;
  }
  return value;
}

router.get('/catalog', async (_req, res) => {
  try {
    const games = await buildPublicCatalog();
    return res.json({ games });
  } catch (err) {
    return handleServerError(res, err, 'Error al obtener catálogo.');
  }
});

router.post('/catalog/validate-player', validatePlayerLimiter, async (req, res) => {
  try {
    const packageId = String(req.body?.packageId || '').trim();
    const extracted = extractTargetFieldsFromPayload({
      targetPayload: req.body?.targetPayload,
      playerId: req.body?.playerId,
      zoneId: req.body?.zoneId
    });

    if (!packageId || !extracted.playerId) {
      return res.status(400).json({ error: 'Paquete e ID de jugador son obligatorios.' });
    }

    const result = await validatePlayerWithPool({
      packageId,
      playerId: extracted.playerId,
      zoneId: extracted.zoneId || undefined,
      targetPayload: extracted.targetPayload
    });
    return res.json(result);
  } catch (err) {
    return handleServerError(res, err, 'Error al validar cuenta de jugador.');
  }
});

router.get('/catalog/margins', async (_req, res) => {
  try {
    const margins = await ProductMargin.findAll({ where: { active: true } });
    return res.json({
      margins: margins.map((m) => ({
        id: m.id,
        publicPriceUsd: Number(m.publicPriceUsd),
        resellerPriceUsd: Number(m.resellerPriceUsd)
      }))
    });
  } catch (err) {
    return handleServerError(res, err, 'Error al obtener tarifas.');
  }
});

router.get('/catalog/channels', async (_req, res) => {
  try {
    const channels = await PaymentChannel.findAll({
      where: { active: true },
      order: [['priority', 'ASC'], ['name', 'ASC']]
    });
    return res.json({
      channels: channels.map(formatPublicChannel)
    });
  } catch (err) {
    return handleServerError(res, err, 'Error al obtener canales de pago.');
  }
});

router.get('/catalog/hero-banners', async (_req, res) => {
  try {
    const banners = await buildPublicHeroBanners();
    return res.json({ banners });
  } catch (err) {
    return handleServerError(res, err, 'Error al obtener banners.');
  }
});

router.post('/reseller-applications', applicationLimiter, async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const businessName = req.body?.businessName ? String(req.body.businessName).trim() : null;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phoneRaw = String(req.body?.phone || '').trim();
    const monthlyVolume = String(req.body?.monthlyVolume || '').trim();
    const message = req.body?.message ? String(req.body.message).trim() : null;

    if (!fullName || !email || !phoneRaw || !monthlyVolume) {
      return res.status(400).json({
        error: 'Completa nombre, correo, teléfono y volumen estimado.'
      });
    }

    const phone = phoneRaw.startsWith('+593') ? phoneRaw : `+593 ${phoneRaw}`;
    const referenceCode = generateOrderCode('RES');

    const created = await ResellerApplication.create({
      referenceCode,
      fullName,
      businessName,
      email,
      phone,
      monthlyVolume,
      message,
      status: 'Pendiente'
    });

    return res.status(201).json({
      referenceCode: created.referenceCode,
      status: created.status
    });
  } catch (err) {
    return handleServerError(res, err, 'Error al registrar solicitud de revendedor.');
  }
});

router.get('/auth/admin-setup-status', async (_req, res) => {
  try {
    const adminCount = await User.count({ where: { role: 'Super Administrador' } });
    return res.json({ needsSetup: adminCount === 0 });
  } catch (err) {
    return handleServerError(res, err, 'Error al verificar estado inicial.');
  }
});

router.post('/auth/admin-setup', authLimiter, async (req, res) => {
  const tx = await sequelize.transaction();
  try {
    const adminCount = await User.count({
      where: { role: 'Super Administrador' },
      transaction: tx
    });
    if (adminCount > 0) {
      await tx.rollback();
      return res.status(403).json({
        error: 'El Super Administrador inicial ya fue configurado.'
      });
    }

    const fullName = String(req.body?.fullName || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phoneRaw = String(req.body?.phone || '').trim();
    const password = String(req.body?.password || '');

    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      await tx.rollback();
      return res.status(400).json({
        error: 'Completa nombre, correo válido y contraseña de al menos 8 caracteres.'
      });
    }

    const existing = await User.findOne({ where: { email }, transaction: tx });
    if (existing) {
      await tx.rollback();
      return res.status(409).json({ error: 'Ya existe una cuenta registrada con ese correo.' });
    }

    const phone = phoneRaw
      ? phoneRaw.startsWith('+593')
        ? phoneRaw
        : `+593 ${phoneRaw}`
      : '+593 99 000 0000';

    const created = await User.create(
      {
        fullName,
        email,
        phone,
        passwordHash: hashPassword(password),
        role: 'Super Administrador',
        walletBalanceUsd: 0,
        active: true
      },
      { transaction: tx }
    );

    await tx.commit();
    const token = signUserToken(created);
    const profile = await buildUserPayload(created.id);
    return res.status(201).json({ token, user: profile });
  } catch (err) {
    await tx.rollback().catch(() => {});
    return handleServerError(res, err, 'Error al configurar Super Administrador.');
  }
});

router.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Ingresa tu correo y contraseña.' });
    }

    const user = await User.findOne({ where: { email } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Tu cuenta se encuentra pausada.' });
    }

    const token = signUserToken(user);
    const profile = await buildUserPayload(user.id);
    return res.json({ token, user: profile });
  } catch (err) {
    return handleServerError(res, err, 'Error al iniciar sesión.');
  }
});

router.post('/auth/register', authLimiter, async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phoneRaw = String(req.body?.phone || '').trim();
    const password = String(req.body?.password || '');

    if (!fullName || !email || !phoneRaw || password.length < 6) {
      return res.status(400).json({
        error: 'Completa nombre, correo, teléfono y contraseña (mínimo 6 caracteres).'
      });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    }

    const phone = phoneRaw.startsWith('+593') ? phoneRaw : `+593 ${phoneRaw}`;
    const created = await User.create({
      fullName,
      email,
      phone,
      passwordHash: hashPassword(password),
      role: 'Cliente',
      walletBalanceUsd: 0,
      active: true
    });

    const token = signUserToken(created);
    const profile = await buildUserPayload(created.id);
    return res.status(201).json({ token, user: profile });
  } catch (err) {
    return handleServerError(res, err, 'Error al registrar cuenta.');
  }
});

router.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const profile = await buildUserPayload(req.auth.sub);
    if (!profile) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    return res.json({ user: profile });
  } catch (err) {
    return handleServerError(res, err, 'Error al obtener perfil.');
  }
});

router.patch('/auth/profile', requireAuth, async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const phoneRaw = String(req.body?.phone || '').trim();
    if (!fullName || !phoneRaw) {
      return res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
    }

    const user = await User.findByPk(req.auth.sub);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const phone = phoneRaw.startsWith('+593') ? phoneRaw : `+593 ${phoneRaw}`;
    await user.update({ fullName, phone });

    const profile = await buildUserPayload(user.id);
    return res.json({ user: profile });
  } catch (err) {
    return handleServerError(res, err, 'Error al actualizar perfil.');
  }
});

router.patch('/auth/password', requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || newPassword.length < 6) {
      return res.status(400).json({
        error: 'Ingresa tu contraseña actual y una nueva de al menos 6 caracteres.'
      });
    }

    const user = await User.findByPk(req.auth.sub);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });
    }

    await user.update({ passwordHash: hashPassword(newPassword) });
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al cambiar contraseña.');
  }
});

router.post('/wallet/topup', requireAuth, async (req, res) => {
  try {
    const amountUsd = Number.parseFloat(req.body?.amountUsd);
    const paymentMethod = String(req.body?.paymentMethod || 'Transferencia / Deuna!').trim();
    const referenceCodeRaw = String(req.body?.referenceCode || '').trim();
    const proofImage = sanitizeProofImage(req.body?.proofImage);

    if (!Number.isFinite(amountUsd) || amountUsd < 1 || amountUsd > 10000) {
      return res.status(400).json({ error: 'Ingresa un monto válido entre $1 y $10,000 USD.' });
    }

    const user = await User.findByPk(req.auth.sub);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const orderCode = generateOrderCode('FND');
    const createdOrder = await Order.create({
      userId: user.id,
      orderCode,
      gameTitle: 'Fondeo de Billetera USD',
      packageLabel: 'Recarga de saldo',
      playerId: user.email,
      amountUsd: Number(amountUsd.toFixed(2)),
      paymentMethod,
      referenceCode: referenceCodeRaw || orderCode,
      proofImage,
      status: 'Pendiente'
    });

    const profile = await buildUserPayload(user.id);
    return res.status(201).json({
      user: profile,
      order: {
        id: createdOrder.orderCode,
        amountUsd: Number(createdOrder.amountUsd),
        status: createdOrder.status
      }
    });
  } catch (err) {
    return handleServerError(res, err, 'Error al registrar solicitud de fondeo.');
  }
});

router.post('/saved-ids', requireAuth, async (req, res) => {
  try {
    const gameTitle = String(req.body?.gameTitle || '').trim();
    const playerId = String(req.body?.playerId || '').trim();
    const zoneId = req.body?.zoneId ? String(req.body.zoneId).trim() : null;
    const accountName = req.body?.accountName
      ? String(req.body.accountName).trim()
      : `Cuenta ${playerId.slice(0, 8)}`;
    const whatsapp = req.body?.whatsapp ? String(req.body.whatsapp).trim() : null;

    if (!gameTitle || !playerId) {
      return res.status(400).json({ error: 'Juego e ID de jugador son obligatorios.' });
    }

    const existing = await SavedId.findOne({
      where: { userId: req.auth.sub, gameTitle, playerId }
    });

    if (existing) {
      await existing.update({
        zoneId: zoneId ?? existing.zoneId,
        accountName: req.body?.accountName ? accountName : existing.accountName || accountName,
        whatsapp: whatsapp ?? existing.whatsapp
      });
    } else {
      await SavedId.create({
        userId: req.auth.sub,
        gameTitle,
        playerId,
        zoneId,
        accountName,
        whatsapp
      });
    }

    const profile = await buildUserPayload(req.auth.sub);
    return res.json({ user: profile });
  } catch (err) {
    return handleServerError(res, err, 'Error al guardar ID.');
  }
});

router.post('/orders', requireAuth, async (req, res) => {
  const tx = await sequelize.transaction();
  try {
    const packageId = req.body?.packageId ? String(req.body.packageId).trim() : null;
    const gameTitle = String(req.body?.gameTitle || '').trim();
    const packageLabel = String(req.body?.packageLabel || '').trim();
    const extracted = extractTargetFieldsFromPayload({
      targetPayload: req.body?.targetPayload,
      playerId: req.body?.playerId,
      zoneId: req.body?.zoneId
    });
    const playerId = extracted.playerId;
    const zoneId = extracted.zoneId;
    const accountName = req.body?.accountName
      ? String(req.body.accountName).trim()
      : `Cuenta ${playerId.slice(0, 8)}`;
    const whatsapp = req.body?.whatsapp ? String(req.body.whatsapp).trim() : null;
    const paymentMethod = String(req.body?.paymentMethod || 'Billetera Nova USD').trim();
    const referenceCodeRaw = req.body?.referenceCode ? String(req.body.referenceCode).trim() : '';
    const proofImage = sanitizeProofImage(req.body?.proofImage);
    const usedWallet = Boolean(req.body?.usedWallet);

    if (!gameTitle || !packageLabel || !playerId) {
      await tx.rollback();
      return res.status(400).json({ error: 'Datos de orden incompletos.' });
    }

    const user = await User.findByPk(req.auth.sub, {
      transaction: tx,
      lock: tx.LOCK.UPDATE
    });
    if (!user) {
      await tx.rollback();
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const productMargin = packageId
      ? await ProductMargin.findByPk(packageId, { transaction: tx })
      : await ProductMargin.findOne({ where: { gameTitle, packageLabel }, transaction: tx });

    if (!productMargin || !productMargin.active) {
      await tx.rollback();
      return res.status(400).json({ error: 'El paquete seleccionado no está disponible.' });
    }

    const authoritativeAmountUsd = Number(
      (user.role === 'Revendedor'
        ? Number(productMargin.resellerPriceUsd)
        : Number(productMargin.publicPriceUsd)
      ).toFixed(2)
    );

    if (usedWallet) {
      const currentBal = Number(user.walletBalanceUsd);
      if (currentBal < authoritativeAmountUsd) {
        await tx.rollback();
        return res.status(400).json({ error: 'Saldo insuficiente en Billetera USD.' });
      }
      await user.update(
        { walletBalanceUsd: Number((currentBal - authoritativeAmountUsd).toFixed(2)) },
        { transaction: tx }
      );
    }

    const displayPlayerId = zoneId && !playerId.includes(zoneId) ? `${playerId} (${zoneId})` : playerId;
    const orderCode = generateOrderCode('ORD');
    const orderStatus = usedWallet ? 'Completado' : 'Pendiente';

    const createdOrder = await Order.create(
      {
        userId: user.id,
        orderCode,
        packageId: productMargin.id,
        gameTitle: productMargin.gameTitle,
        packageLabel: productMargin.packageLabel,
        playerId: displayPlayerId,
        amountUsd: authoritativeAmountUsd,
        paymentMethod: usedWallet ? 'Billetera Nova USD' : paymentMethod,
        referenceCode: referenceCodeRaw || orderCode,
        proofImage: usedWallet ? null : proofImage,
        targetPayloadJson: extracted.targetPayload ? JSON.stringify(extracted.targetPayload) : null,
        status: orderStatus
      },
      { transaction: tx }
    );

    const existingSaved = await SavedId.findOne({
      where: { userId: user.id, gameTitle: productMargin.gameTitle, playerId },
      transaction: tx
    });
    if (existingSaved) {
      await existingSaved.update(
        {
          zoneId: zoneId ?? existingSaved.zoneId,
          accountName: req.body?.accountName ? accountName : existingSaved.accountName || accountName,
          whatsapp: whatsapp ?? existingSaved.whatsapp
        },
        { transaction: tx }
      );
    } else {
      await SavedId.create(
        {
          userId: user.id,
          gameTitle: productMargin.gameTitle,
          playerId,
          zoneId,
          accountName,
          whatsapp
        },
        { transaction: tx }
      );
    }

    await tx.commit();

    if (usedWallet) {
      setImmediate(() => {
        fulfillOrderWithPool(createdOrder.id, { playerId, zoneId }).catch((err) => {
          logger.warn(`Despacho automático pendiente/fallido para ${createdOrder.orderCode}: ${err.message}`);
        });
      });
    }

    const profile = await buildUserPayload(user.id);
    return res.status(201).json({
      user: profile,
      order: {
        id: createdOrder.orderCode,
        gameTitle: createdOrder.gameTitle,
        packageLabel: createdOrder.packageLabel,
        playerId: createdOrder.playerId,
        amountUsd: Number(createdOrder.amountUsd),
        paymentMethod: createdOrder.paymentMethod,
        status: createdOrder.status,
        createdAt: new Date(createdOrder.createdAt).toISOString(),
        dateLabel: new Date(createdOrder.createdAt).toLocaleString('es-EC', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        })
      }
    });
  } catch (err) {
    await tx.rollback().catch(() => {});
    return handleServerError(res, err, 'Error al procesar orden.');
  }
});

const ALLOWED_API_SCOPES = new Set([
  'catalog:read',
  'balance:read',
  'orders:read',
  'orders:write'
]);

router.get('/api-keys', requireAuth, async (req, res) => {
  try {
    const keys = await ApiKey.findAll({
      where: { userId: req.auth.sub },
      order: [['createdAt', 'DESC']]
    });
    return res.json({
      apiKeys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        environment: k.environment || 'production',
        scopes: String(k.scopes || '').split(',').filter(Boolean),
        allowedIps: k.allowedIps || '',
        active: Boolean(k.active),
        lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt).toISOString() : null,
        revokedAt: k.revokedAt ? new Date(k.revokedAt).toISOString() : null,
        createdAt: new Date(k.createdAt).toISOString()
      }))
    });
  } catch (err) {
    return handleServerError(res, err, 'Error al listar API keys.');
  }
});

router.post('/api-keys', requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 60) {
      return res.status(400).json({ error: 'Ingresa un nombre válido (máx. 60 caracteres).' });
    }

    const activeCount = await ApiKey.count({
      where: { userId: req.auth.sub, active: true }
    });
    if (activeCount >= 5) {
      return res.status(400).json({ error: 'Máximo 5 API keys activas por cuenta.' });
    }

    const requestedScopes = Array.isArray(req.body?.scopes)
      ? req.body.scopes.map((s) => String(s).trim()).filter((s) => ALLOWED_API_SCOPES.has(s))
      : ['catalog:read', 'balance:read', 'orders:read', 'orders:write'];

    if (requestedScopes.length === 0) {
      return res.status(400).json({ error: 'Selecciona al menos un permiso válido.' });
    }

    const environment = req.body?.environment === 'sandbox' ? 'sandbox' : 'production';
    const allowedIps = req.body?.allowedIps ? String(req.body.allowedIps).trim() : null;
    const plainKey = generatePlainApiKey(environment);
    const keyPrefix = plainKey.slice(0, 16);
    const keyHash = hashApiKey(plainKey);

    const created = await ApiKey.create({
      userId: req.auth.sub,
      name,
      keyPrefix,
      environment,
      keyHash,
      scopes: requestedScopes.join(','),
      allowedIps,
      active: true
    });

    return res.status(201).json({
      plainKey,
      apiKey: {
        id: created.id,
        name: created.name,
        keyPrefix: created.keyPrefix,
        environment: created.environment,
        scopes: requestedScopes,
        allowedIps: created.allowedIps || '',
        active: true,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(created.createdAt).toISOString()
      }
    });
  } catch (err) {
    return handleServerError(res, err, 'Error al generar API key.');
  }
});

router.delete('/api-keys/:id', requireAuth, async (req, res) => {
  try {
    const key = await ApiKey.findOne({
      where: { id: req.params.id, userId: req.auth.sub }
    });
    if (!key) {
      return res.status(404).json({ error: 'API key no encontrada.' });
    }
    await key.update({ active: false, revokedAt: new Date() });
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al revocar API key.');
  }
});

module.exports = router;
