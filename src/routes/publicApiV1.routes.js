const express = require('express');
const { sequelize } = require('../config/database');
const { requireApiKey, requireScope } = require('../middleware/apiKeyAuth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { Game, Order, ProductMargin, User } = require('../models');
const { fulfillOrderWithPool, validatePlayerWithPool } = require('../providers/supplierPool');
const logger = require('../utils/logger');
const { buildPublicApiCatalog } = require('../utils/userPayload');

const router = express.Router();

const v1Limiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  message: 'Límite de 60 peticiones por minuto alcanzado.'
});

router.get('/health', (_req, res) => {
  res.json({ ok: true, version: 'v1', service: 'novacoins-public-api' });
});

router.use(v1Limiter, requireApiKey);

router.get('/ping', requireScope('catalog:read'), (req, res) => {
  res.json({
    ok: true,
    environment: req.apiKeyAuth.environment,
    role: req.apiKeyAuth.role,
    scopes: Array.from(req.apiKeyAuth.scopes)
  });
});

router.get('/catalog', requireScope('catalog:read'), async (req, res) => {
  try {
    const games = await buildPublicApiCatalog();
    const isReseller = req.apiKeyAuth.role === 'Revendedor';

    return res.json({
      environment: req.apiKeyAuth.environment,
      currency: 'USD',
      tier: isReseller ? 'reseller' : 'public',
      games: games.map((g) => ({
        id: g.id,
        title: g.title,
        category: g.category,
        requiresZoneId: g.requiresZoneId,
        packages: g.packages.map((p) => ({
          id: p.id,
          label: p.label,
          unitPriceUsd: isReseller ? p.resellerPriceUsd : p.publicPriceUsd
        }))
      }))
    });
  } catch (err) {
    logger.error(`[API v1] Error en GET /catalog: ${err.message}`);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Error al obtener catálogo.' } });
  }
});

router.get('/balance', requireScope('balance:read'), async (req, res) => {
  try {
    const isSandbox = req.apiKeyAuth.environment === 'sandbox';
    const user = await User.findByPk(req.apiKeyAuth.userId, {
      attributes: ['walletBalanceUsd', 'sandboxBalanceUsd', 'role']
    });
    if (!user) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Cuenta no encontrada.' } });
    }
    return res.json({
      environment: req.apiKeyAuth.environment,
      availableBalanceUsd: Number(isSandbox ? user.sandboxBalanceUsd : user.walletBalanceUsd),
      currency: 'USD',
      role: user.role
    });
  } catch (err) {
    logger.error(`[API v1] Error en GET /balance: ${err.message}`);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Error al consultar saldo.' } });
  }
});

router.post('/player/validate', requireScope('catalog:read'), async (req, res) => {
  try {
    const packageId = String(req.body?.packageId || '').trim();
    const playerId = String(req.body?.playerId || '').trim();
    const zoneId = req.body?.zoneId ? String(req.body.zoneId).trim() : undefined;

    if (!packageId || !playerId) {
      return res.status(400).json({
        error: { code: 'invalid_request', message: 'packageId y playerId son obligatorios.' }
      });
    }

    const margin = await ProductMargin.findByPk(packageId);
    if (!margin || !margin.active || !margin.apiEnabled) {
      return res.status(404).json({
        error: { code: 'not_found', message: 'Producto no habilitado para API.' }
      });
    }

    if (req.apiKeyAuth.environment === 'sandbox') {
      if (playerId === '000000') {
        return res.json({ status: 'invalid', playerName: null, reason: 'sandbox_invalid_player' });
      }
      return res.json({
        status: 'valid',
        playerName: `Sandbox_${playerId.slice(0, 8)}`,
        reason: null
      });
    }

    const result = await validatePlayerWithPool({ packageId, playerId, zoneId });
    return res.json(result);
  } catch (err) {
    logger.error(`[API v1] Error en POST /player/validate: ${err.message}`);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Error validando jugador.' } });
  }
});

router.post('/orders', requireScope('orders:write'), async (req, res) => {
  const tx = await sequelize.transaction();
  const isSandbox = req.apiKeyAuth.environment === 'sandbox';

  try {
    const packageId = String(req.body?.packageId || '').trim();
    const playerId = String(req.body?.playerId || '').trim();
    const zoneId = req.body?.zoneId ? String(req.body.zoneId).trim() : null;
    const idempHeader = String(req.headers['idempotency-key'] || '').trim();

    if (!packageId || !playerId) {
      await tx.rollback();
      return res.status(400).json({
        error: { code: 'invalid_request', message: 'packageId y playerId son obligatorios.' }
      });
    }

    if (idempHeader) {
      const existingByKey = await Order.findOne({
        where: {
          userId: req.apiKeyAuth.userId,
          isSandbox,
          idempotencyKey: `uapi-${req.apiKeyAuth.environment}-${idempHeader}`
        },
        transaction: tx
      });
      if (existingByKey) {
        await tx.commit();
        return res.status(201).json({
          environment: req.apiKeyAuth.environment,
          order: {
            id: existingByKey.orderCode,
            packageId: existingByKey.packageId,
            playerId: existingByKey.playerId,
            amountUsd: Number(existingByKey.amountUsd),
            status: existingByKey.status,
            fulfillmentStatus: existingByKey.fulfillmentStatus,
            createdAt: existingByKey.createdAt
          }
        });
      }
    }

    const user = await User.findByPk(req.apiKeyAuth.userId, {
      transaction: tx,
      lock: tx.LOCK.UPDATE
    });
    if (!user) {
      await tx.rollback();
      return res.status(404).json({ error: { code: 'not_found', message: 'Usuario no encontrado.' } });
    }

    const productMargin = await ProductMargin.findByPk(packageId, {
      include: [{ model: Game, attributes: ['active', 'category'] }],
      transaction: tx
    });
    if (
      !productMargin ||
      !productMargin.active ||
      !productMargin.apiEnabled ||
      (productMargin.Game && !productMargin.Game.active)
    ) {
      await tx.rollback();
      return res.status(404).json({
        error: { code: 'not_found', message: 'El paquete solicitado no está habilitado en la API.' }
      });
    }

    const unitPriceUsd = Number(
      (user.role === 'Revendedor'
        ? Number(productMargin.resellerPriceUsd)
        : Number(productMargin.publicPriceUsd)
      ).toFixed(2)
    );

    const balanceField = isSandbox ? 'sandboxBalanceUsd' : 'walletBalanceUsd';
    const currentBal = Number(user[balanceField]);
    if (currentBal < unitPriceUsd) {
      await tx.rollback();
      return res.status(409).json({
        error: {
          code: 'insufficient_balance',
          message: isSandbox ? 'Saldo Sandbox insuficiente.' : 'Saldo insuficiente en Billetera USD.'
        }
      });
    }

    await user.update(
      { [balanceField]: Number((currentBal - unitPriceUsd).toFixed(2)) },
      { transaction: tx }
    );

    const displayPlayerId = zoneId && !playerId.includes(zoneId) ? `${playerId} (${zoneId})` : playerId;
    const prefix = isSandbox ? 'SBX' : 'API';
    const orderCode = `${prefix}-${Date.now().toString().slice(-6)}${Math.floor(10 + Math.random() * 89)}`;

    const isGiftCard = productMargin.Game?.category === 'giftcard';
    const sandboxCodes =
      isSandbox && isGiftCard
        ? JSON.stringify([`SBX-PIN-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`])
        : null;

    const createdOrder = await Order.create(
      {
        userId: user.id,
        orderCode,
        packageId: productMargin.id,
        gameTitle: productMargin.gameTitle,
        packageLabel: productMargin.packageLabel,
        playerId: displayPlayerId,
        amountUsd: unitPriceUsd,
        paymentMethod: isSandbox ? 'Sandbox Wallet USD' : 'Billetera Nova USD',
        referenceCode: orderCode,
        idempotencyKey: idempHeader ? `uapi-${req.apiKeyAuth.environment}-${idempHeader}` : null,
        isSandbox,
        fulfillmentStatus: isSandbox ? 'completed' : 'none',
        deliveredCodes: sandboxCodes,
        status: 'Completado'
      },
      { transaction: tx }
    );

    await tx.commit();

    if (!isSandbox) {
      setImmediate(() => {
        fulfillOrderWithPool(createdOrder.id, { playerId, zoneId }).catch((err) => {
          logger.warn(`[API v1] Despacho pendiente/fallido para ${createdOrder.orderCode}: ${err.message}`);
        });
      });
    }

    return res.status(201).json({
      environment: req.apiKeyAuth.environment,
      order: {
        id: createdOrder.orderCode,
        packageId: createdOrder.packageId,
        gameTitle: createdOrder.gameTitle,
        packageLabel: createdOrder.packageLabel,
        playerId: createdOrder.playerId,
        amountUsd: Number(createdOrder.amountUsd),
        status: createdOrder.status,
        fulfillmentStatus: createdOrder.fulfillmentStatus,
        ...(sandboxCodes ? { codes: JSON.parse(sandboxCodes) } : {}),
        createdAt: createdOrder.createdAt
      }
    });
  } catch (err) {
    await tx.rollback().catch(() => {});
    logger.error(`[API v1] Error en POST /orders: ${err.message}`);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Error al crear orden.' } });
  }
});

router.get('/orders', requireScope('orders:read'), async (req, res) => {
  try {
    const isSandbox = req.apiKeyAuth.environment === 'sandbox';
    const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit || '20'), 10) || 20));
    const orders = await Order.findAll({
      where: { userId: req.apiKeyAuth.userId, isSandbox },
      order: [['createdAt', 'DESC']],
      limit
    });

    return res.json({
      environment: req.apiKeyAuth.environment,
      orders: orders.map((o) => ({
        id: o.orderCode,
        packageId: o.packageId,
        gameTitle: o.gameTitle,
        packageLabel: o.packageLabel,
        playerId: o.playerId,
        amountUsd: Number(o.amountUsd),
        status: o.status,
        fulfillmentStatus: o.fulfillmentStatus,
        createdAt: o.createdAt
      }))
    });
  } catch (err) {
    logger.error(`[API v1] Error en GET /orders: ${err.message}`);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Error al listar órdenes.' } });
  }
});

router.get('/orders/:orderCode', requireScope('orders:read'), async (req, res) => {
  try {
    const isSandbox = req.apiKeyAuth.environment === 'sandbox';
    const order = await Order.findOne({
      where: {
        userId: req.apiKeyAuth.userId,
        isSandbox,
        orderCode: String(req.params.orderCode || '').trim()
      }
    });
    if (!order) {
      return res.status(404).json({ error: { code: 'not_found', message: 'Orden no encontrada.' } });
    }

    let codes = undefined;
    if (order.deliveredCodes) {
      try {
        codes = JSON.parse(order.deliveredCodes);
      } catch {
        codes = undefined;
      }
    }

    return res.json({
      environment: req.apiKeyAuth.environment,
      order: {
        id: order.orderCode,
        packageId: order.packageId,
        gameTitle: order.gameTitle,
        packageLabel: order.packageLabel,
        playerId: order.playerId,
        amountUsd: Number(order.amountUsd),
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        failureMessage: order.failureMessage || null,
        codes,
        createdAt: order.createdAt
      }
    });
  } catch (err) {
    logger.error(`[API v1] Error en GET /orders/:orderCode: ${err.message}`);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Error al consultar orden.' } });
  }
});

module.exports = router;
