const express = require('express');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { IS_PROD } = require('../config/env');
const { requireAuth, requireSuperAdmin } = require('../middleware/auth');
const {
  Game,
  HeroBanner,
  Order,
  PaymentChannel,
  ProductMargin,
  ResellerApplication,
  Supplier,
  SupplierProduct,
  SystemConfig,
  User,
  WalletAdjustment
} = require('../models');
const {
  fulfillOrderWithPool,
  getAdapterById,
  refreshSupplierBalance,
  syncOrderStatusFromSupplier,
  syncSupplierCatalog
} = require('../providers/supplierPool');
const logger = require('../utils/logger');
const { hashPassword } = require('../utils/password');
const { computeSuggestedPrices, extractProductPatterns } = require('../utils/supplierNormalizer');
const { buildAdminSnapshot } = require('../utils/userPayload');

const router = express.Router();

function handleServerError(res, err, fallbackMessage) {
  logger.error(`${fallbackMessage}: ${err.message}`);
  return res.status(500).json({ error: IS_PROD ? fallbackMessage : err.message || fallbackMessage });
}

function slugifyId(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

router.use(requireAuth, requireSuperAdmin);

router.get('/snapshot', async (_req, res) => {
  try {
    const snapshot = await buildAdminSnapshot();
    return res.json(snapshot);
  } catch (err) {
    return handleServerError(res, err, 'Error al cargar datos.');
  }
});

router.get('/orders', async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit || '25'), 10) || 25));
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim();

    const where = { isSandbox: false };
    if (status && ['Pendiente', 'Aprobado', 'Completado', 'Rechazado'].includes(status)) {
      where.status = status;
    }
    if (search) {
      where[Op.or] = [
        { orderCode: { [Op.iLike]: `%${search}%` } },
        { referenceCode: { [Op.iLike]: `%${search}%` } },
        { gameTitle: { [Op.iLike]: `%${search}%` } },
        { playerId: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows } = await Order.findAndCountAll({
      where,
      include: [{ model: User, attributes: ['fullName', 'role', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit
    });

    return res.json({
      total: count,
      page,
      totalPages: Math.max(1, Math.ceil(count / limit)),
      items: rows.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        customerName: o.User?.fullName || 'Cliente',
        customerEmail: o.User?.email || '',
        customerRole: o.User?.role || 'Cliente',
        typeLabel: `${o.gameTitle} · ${o.packageLabel}`,
        playerId: o.playerId,
        channel: o.paymentMethod,
        referenceCode: o.referenceCode || o.orderCode,
        proofImage: o.proofImage || undefined,
        adminNote: o.adminNote || undefined,
        amountUsd: Number(o.amountUsd),
        status: o.status === 'Pendiente' || o.status === 'Rechazado' ? o.status : 'Aprobado',
        timeLabel: new Date(o.createdAt).toLocaleString('es-EC', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        })
      }))
    });
  } catch (err) {
    return handleServerError(res, err, 'Error al consultar órdenes.');
  }
});

router.patch('/payment-mode', async (req, res) => {
  try {
    const mode = req.body?.mode === 'auto' ? 'auto' : 'manual';
    await SystemConfig.upsert({ key: 'paymentMode', value: mode });
    return res.json({ paymentMode: mode });
  } catch (err) {
    return handleServerError(res, err, 'Error al cambiar modo de cobro.');
  }
});

router.patch('/payments/:id/decision', async (req, res) => {
  const tx = await sequelize.transaction();
  try {
    const decision = req.body?.status === 'Aprobado' ? 'Aprobado' : 'Rechazado';
    const adminNote = req.body?.adminNote ? String(req.body.adminNote).trim() : null;

    const order = await Order.findByPk(req.params.id, {
      transaction: tx,
      lock: tx.LOCK.UPDATE
    });
    if (!order) {
      await tx.rollback();
      return res.status(404).json({ error: 'Orden no encontrada.' });
    }

    if (order.status !== 'Pendiente') {
      await tx.rollback();
      return res.status(409).json({ error: 'Esta orden ya fue procesada anteriormente.' });
    }

    await order.update(
      {
        status: decision,
        adminNote,
        processedAt: new Date()
      },
      { transaction: tx }
    );

    if (decision === 'Aprobado' && order.gameTitle === 'Fondeo de Billetera USD') {
      const user = await User.findByPk(order.userId, {
        transaction: tx,
        lock: tx.LOCK.UPDATE
      });
      if (user) {
        const nextBal = Number((Number(user.walletBalanceUsd) + Number(order.amountUsd)).toFixed(2));
        await user.update({ walletBalanceUsd: nextBal }, { transaction: tx });
      }
    }

    await tx.commit();

    if (decision === 'Aprobado' && order.gameTitle !== 'Fondeo de Billetera USD') {
      setImmediate(() => {
        fulfillOrderWithPool(order.id).catch((err) => {
          logger.warn(`Despacho post-aprobación fallido para ${order.orderCode}: ${err.message}`);
        });
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    await tx.rollback().catch(() => {});
    return handleServerError(res, err, 'Error al actualizar comprobante.');
  }
});

router.post('/games', async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const publisher = String(req.body?.publisher || '').trim();
    const currencyName = String(req.body?.currencyName || '').trim();
    const category = req.body?.category === 'giftcard' ? 'giftcard' : 'topup';

    if (!title || !publisher || !currencyName) {
      return res.status(400).json({ error: 'Título, publisher y moneda son obligatorios.' });
    }

    const baseId = slugifyId(req.body?.id || title) || `game-${Date.now()}`;
    const existing = await Game.findByPk(baseId);
    const id = existing ? `${baseId}-${Date.now().toString().slice(-4)}` : baseId;

    const created = await Game.create({
      id,
      slug: id,
      title,
      publisher,
      currencyName,
      category,
      categoryLabel: String(req.body?.categoryLabel || (category === 'giftcard' ? 'Gift Card' : 'Top-Up por ID')).trim(),
      badgeText: String(req.body?.badgeText || 'Disponible').trim(),
      deliverySpeed: String(req.body?.deliverySpeed || 'Instantáneo').trim(),
      requiresZoneId: Boolean(req.body?.requiresZoneId),
      inputLabel: String(req.body?.inputLabel || 'ID de Jugador').trim(),
      inputPlaceholder: String(req.body?.inputPlaceholder || 'Ingresa tu ID').trim(),
      zonePlaceholder: req.body?.zonePlaceholder ? String(req.body.zonePlaceholder).trim() : null,
      accentGradient: String(req.body?.accentGradient || '#000000').trim(),
      accentColor: String(req.body?.accentColor || '#FACC15').trim(),
      shortCode: String(req.body?.shortCode || title.slice(0, 3).toUpperCase()).trim().toUpperCase(),
      logoUrl: req.body?.logoUrl ? String(req.body.logoUrl).trim() : null,
      isHot: Boolean(req.body?.isHot),
      active: req.body?.active !== false,
      sortOrder: Number.parseInt(String(req.body?.sortOrder || '99'), 10) || 99
    });

    return res.status(201).json({ game: created });
  } catch (err) {
    return handleServerError(res, err, 'Error al crear juego.');
  }
});

router.patch('/games/:id', async (req, res) => {
  try {
    const game = await Game.findByPk(req.params.id);
    if (!game) {
      return res.status(404).json({ error: 'Juego no encontrado.' });
    }

    const updates = {};
    const strFields = [
      'title',
      'publisher',
      'currencyName',
      'categoryLabel',
      'badgeText',
      'deliverySpeed',
      'inputLabel',
      'inputPlaceholder',
      'zonePlaceholder',
      'accentColor',
      'shortCode',
      'logoUrl'
    ];
    for (const field of strFields) {
      if (req.body?.[field] !== undefined) {
        updates[field] = req.body[field] === null ? null : String(req.body[field]).trim();
      }
    }
    if (req.body?.category === 'topup' || req.body?.category === 'giftcard') {
      updates.category = req.body.category;
    }
    if (req.body?.requiresZoneId !== undefined) {
      updates.requiresZoneId = Boolean(req.body.requiresZoneId);
    }
    if (req.body?.isHot !== undefined) {
      updates.isHot = Boolean(req.body.isHot);
    }
    if (req.body?.active !== undefined) {
      updates.active = Boolean(req.body.active);
    }
    if (req.body?.sortOrder !== undefined) {
      const sortOrder = Number.parseInt(String(req.body.sortOrder), 10);
      if (Number.isFinite(sortOrder)) {
        updates.sortOrder = sortOrder;
      }
    }

    await game.update(updates);
    if (updates.title) {
      await ProductMargin.update(
        { gameTitle: updates.title },
        { where: { gameId: game.id }, individualHooks: true }
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al actualizar juego.');
  }
});

router.delete('/games/:id', async (req, res) => {
  try {
    const game = await Game.findByPk(req.params.id);
    if (!game) {
      return res.status(404).json({ error: 'Juego no encontrado.' });
    }
    await game.destroy();
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al eliminar juego.');
  }
});

router.post('/margins', async (req, res) => {
  try {
    const gameId = String(req.body?.gameId || '').trim();
    const packageLabel = String(req.body?.packageLabel || '').trim();
    const baseCostUsd = Number.parseFloat(req.body?.baseCostUsd);
    const publicPriceUsd = Number.parseFloat(req.body?.publicPriceUsd);
    const resellerPriceUsd = Number.parseFloat(req.body?.resellerPriceUsd);

    const game = await Game.findByPk(gameId);
    if (!game) {
      return res.status(404).json({ error: 'El juego seleccionado no existe.' });
    }
    if (
      !packageLabel ||
      !Number.isFinite(baseCostUsd) ||
      baseCostUsd < 0 ||
      !Number.isFinite(publicPriceUsd) ||
      publicPriceUsd <= 0 ||
      !Number.isFinite(resellerPriceUsd) ||
      resellerPriceUsd <= 0
    ) {
      return res.status(400).json({ error: 'Completa etiqueta y precios válidos en USD.' });
    }

    const baseId = slugifyId(`${game.shortCode}-${packageLabel}`) || `sku-${Date.now()}`;
    const existing = await ProductMargin.findByPk(baseId);
    const id = existing ? `${baseId}-${Date.now().toString().slice(-4)}` : baseId;

    const created = await ProductMargin.create({
      id,
      gameId: game.id,
      gameTitle: game.title,
      packageLabel,
      bonus: req.body?.bonus ? String(req.body.bonus).trim() : null,
      imageUrl: req.body?.imageUrl ? String(req.body.imageUrl).trim() : null,
      baseCostUsd: Number(baseCostUsd.toFixed(2)),
      publicPriceUsd: Number(publicPriceUsd.toFixed(2)),
      resellerPriceUsd: Number(resellerPriceUsd.toFixed(2)),
      popular: Boolean(req.body?.popular),
      active: req.body?.active !== false,
      sortOrder: Number.parseInt(String(req.body?.sortOrder || '99'), 10) || 99
    });

    return res.status(201).json({ margin: created });
  } catch (err) {
    return handleServerError(res, err, 'Error al crear paquete.');
  }
});

router.patch('/margins/:id', async (req, res) => {
  try {
    const margin = await ProductMargin.findByPk(req.params.id);
    if (!margin) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }

    const updates = {};
    if (req.body?.packageLabel !== undefined) {
      const label = String(req.body.packageLabel).trim();
      if (label) {
        updates.packageLabel = label;
      }
    }
    if (req.body?.bonus !== undefined) {
      updates.bonus = req.body.bonus ? String(req.body.bonus).trim() : null;
    }
    if (req.body?.imageUrl !== undefined) {
      updates.imageUrl = req.body.imageUrl ? String(req.body.imageUrl).trim() : null;
    }
    if (req.body?.baseCostUsd !== undefined) {
      const val = Number.parseFloat(req.body.baseCostUsd);
      if (Number.isFinite(val) && val >= 0) {
        updates.baseCostUsd = Number(val.toFixed(2));
      }
    }
    if (req.body?.publicPriceUsd !== undefined) {
      const val = Number.parseFloat(req.body.publicPriceUsd);
      if (Number.isFinite(val) && val >= 0) {
        updates.publicPriceUsd = Number(val.toFixed(2));
      }
    }
    if (req.body?.resellerPriceUsd !== undefined) {
      const val = Number.parseFloat(req.body.resellerPriceUsd);
      if (Number.isFinite(val) && val >= 0) {
        updates.resellerPriceUsd = Number(val.toFixed(2));
      }
    }
    if (req.body?.popular !== undefined) {
      updates.popular = Boolean(req.body.popular);
    }
    if (req.body?.active !== undefined) {
      updates.active = Boolean(req.body.active);
    }
    if (req.body?.apiEnabled !== undefined) {
      updates.apiEnabled = Boolean(req.body.apiEnabled);
    }

    await margin.update(updates);
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al actualizar tarifa.');
  }
});

router.delete('/margins/:id', async (req, res) => {
  try {
    const margin = await ProductMargin.findByPk(req.params.id);
    if (!margin) {
      return res.status(404).json({ error: 'Paquete no encontrado.' });
    }
    await margin.destroy();
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al eliminar paquete.');
  }
});

router.post('/users', async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phoneRaw = String(req.body?.phone || '').trim();
    const password = String(req.body?.password || '');
    const role = ['Cliente', 'Revendedor', 'Super Administrador'].includes(req.body?.role)
      ? req.body.role
      : 'Cliente';
    const walletBalanceUsd = Number.parseFloat(req.body?.walletBalanceUsd || '0');

    if (!fullName || !email || !phoneRaw || password.length < 6) {
      return res.status(400).json({
        error: 'Completa nombre, correo, teléfono y contraseña (mínimo 6 caracteres).'
      });
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
    }

    const phone = phoneRaw.startsWith('+593') ? phoneRaw : `+593 ${phoneRaw}`;
    const created = await User.create({
      fullName,
      email,
      phone,
      passwordHash: hashPassword(password),
      role,
      walletBalanceUsd: Number.isFinite(walletBalanceUsd) && walletBalanceUsd >= 0 ? Number(walletBalanceUsd.toFixed(2)) : 0,
      active: true
    });

    return res.status(201).json({ id: created.id });
  } catch (err) {
    return handleServerError(res, err, 'Error al crear usuario.');
  }
});

router.patch('/users/:id/role', async (req, res) => {
  try {
    if (req.params.id === req.auth.sub) {
      return res.status(400).json({ error: 'No puedes cambiar tu propio rol de Super Administrador.' });
    }

    const role = ['Cliente', 'Revendedor'].includes(req.body?.role) ? req.body.role : null;
    if (!role) {
      return res.status(400).json({ error: 'Rol inválido. Debe ser Cliente o Revendedor.' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    if (user.role === 'Super Administrador') {
      return res.status(400).json({ error: 'No se puede degradar a otro Super Administrador.' });
    }

    await user.update({ role });
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al cambiar rol.');
  }
});

router.post('/users/:id/wallet', async (req, res) => {
  const tx = await sequelize.transaction();
  try {
    const amountUsd = Number.parseFloat(req.body?.amountUsd);
    const type = req.body?.type === 'debit' ? 'debit' : 'credit';
    const reason = String(req.body?.reason || '').trim();

    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      await tx.rollback();
      return res.status(400).json({ error: 'Monto inválido.' });
    }
    if (!reason) {
      await tx.rollback();
      return res.status(400).json({ error: 'Debes indicar el motivo del ajuste.' });
    }

    const user = await User.findByPk(req.params.id, {
      transaction: tx,
      lock: tx.LOCK.UPDATE
    });
    if (!user) {
      await tx.rollback();
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const currentBal = Number(user.walletBalanceUsd);
    const nextBal = Number(
      (type === 'credit' ? currentBal + amountUsd : Math.max(0, currentBal - amountUsd)).toFixed(2)
    );

    await user.update({ walletBalanceUsd: nextBal }, { transaction: tx });
    await WalletAdjustment.create(
      {
        userId: user.id,
        adminId: req.auth.sub,
        type,
        amountUsd: Number(amountUsd.toFixed(2)),
        balanceAfterUsd: nextBal,
        reason
      },
      { transaction: tx }
    );

    await tx.commit();
    logger.info(
      `Ajuste manual de billetera (${type} $${amountUsd.toFixed(2)}) a ${user.email} por admin ${req.auth.email}: ${reason}`
    );
    return res.json({ ok: true });
  } catch (err) {
    await tx.rollback().catch(() => {});
    return handleServerError(res, err, 'Error al ajustar billetera.');
  }
});

router.patch('/users/:id/toggle', async (req, res) => {
  try {
    if (req.params.id === req.auth.sub) {
      return res.status(400).json({ error: 'No puedes pausar tu propia cuenta de Super Administrador.' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    await user.update({ active: !user.active });
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al actualizar usuario.');
  }
});

router.patch('/reseller-applications/:id/decision', async (req, res) => {
  const tx = await sequelize.transaction();
  try {
    const decision = req.body?.status === 'Aprobada' ? 'Aprobada' : 'Rechazada';
    const adminNote = req.body?.adminNote ? String(req.body.adminNote).trim() : null;
    const initialPassword = req.body?.initialPassword ? String(req.body.initialPassword) : '';

    const application = await ResellerApplication.findByPk(req.params.id, {
      transaction: tx,
      lock: tx.LOCK.UPDATE
    });
    if (!application) {
      await tx.rollback();
      return res.status(404).json({ error: 'Solicitud no encontrada.' });
    }

    if (application.status !== 'Pendiente') {
      await tx.rollback();
      return res.status(409).json({ error: 'Esta solicitud ya fue revisada.' });
    }

    await application.update(
      {
        status: decision,
        adminNote,
        reviewedAt: new Date()
      },
      { transaction: tx }
    );

    let affectedUserId = null;
    if (decision === 'Aprobada') {
      const existingUser = await User.findOne({
        where: { email: application.email },
        transaction: tx,
        lock: tx.LOCK.UPDATE
      });

      if (existingUser) {
        if (existingUser.role === 'Cliente') {
          await existingUser.update({ role: 'Revendedor', active: true }, { transaction: tx });
        }
        affectedUserId = existingUser.id;
      } else if (initialPassword.length >= 6) {
        const created = await User.create(
          {
            fullName: application.fullName,
            email: application.email,
            phone: application.phone,
            passwordHash: hashPassword(initialPassword),
            role: 'Revendedor',
            walletBalanceUsd: 0,
            active: true
          },
          { transaction: tx }
        );
        affectedUserId = created.id;
      }
    }

    await tx.commit();
    return res.json({ ok: true, userLinked: Boolean(affectedUserId) });
  } catch (err) {
    await tx.rollback().catch(() => {});
    return handleServerError(res, err, 'Error al procesar solicitud de revendedor.');
  }
});

router.post('/channels', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const accountDetail = String(req.body?.accountDetail || '').trim();
    const priority = req.body?.priority === 'Respaldo' ? 'Respaldo' : 'Principal';
    const qrImage = req.body?.qrImage ? String(req.body.qrImage).trim() : null;
    const publicKey = req.body?.publicKey ? String(req.body.publicKey).trim() : null;
    const privateKey = req.body?.privateKey ? String(req.body.privateKey).trim() : null;

    if (!name || !accountDetail) {
      return res.status(400).json({ error: 'Nombre y detalle de cuenta son obligatorios.' });
    }

    const baseId = `ch-${slugifyId(name) || Date.now()}`;
    const existing = await PaymentChannel.findByPk(baseId);
    const id = existing ? `${baseId}-${Date.now().toString().slice(-4)}` : baseId;

    const created = await PaymentChannel.create({
      id,
      name,
      accountDetail,
      priority,
      qrImage,
      publicKey,
      privateKey,
      active: req.body?.active !== false
    });

    return res.status(201).json({ channel: created });
  } catch (err) {
    return handleServerError(res, err, 'Error al crear canal de cobro.');
  }
});

router.patch('/channels/:id', async (req, res) => {
  try {
    const channel = await PaymentChannel.findByPk(req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Canal no encontrado.' });
    }

    const updates = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name) {
        updates.name = name;
      }
    }
    if (req.body?.accountDetail !== undefined) {
      const detail = String(req.body.accountDetail).trim();
      if (detail) {
        updates.accountDetail = detail;
      }
    }
    if (req.body?.priority === 'Principal' || req.body?.priority === 'Respaldo') {
      updates.priority = req.body.priority;
    }
    if (req.body?.qrImage !== undefined) {
      updates.qrImage = req.body.qrImage ? String(req.body.qrImage).trim() : null;
    }
    if (req.body?.publicKey !== undefined) {
      updates.publicKey = req.body.publicKey ? String(req.body.publicKey).trim() : null;
    }
    if (req.body?.clearPrivateKey === true) {
      updates.privateKey = null;
    } else if (req.body?.privateKey) {
      const priv = String(req.body.privateKey).trim();
      if (priv) {
        updates.privateKey = priv;
      }
    }
    if (req.body?.active !== undefined) {
      updates.active = Boolean(req.body.active);
    }

    await channel.update(updates);
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al actualizar canal.');
  }
});

router.patch('/channels/:id/toggle', async (req, res) => {
  try {
    const channel = await PaymentChannel.findByPk(req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Canal no encontrado.' });
    }

    await channel.update({ active: !channel.active });
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al actualizar canal.');
  }
});

router.delete('/channels/:id', async (req, res) => {
  try {
    const channel = await PaymentChannel.findByPk(req.params.id);
    if (!channel) {
      return res.status(404).json({ error: 'Canal no encontrado.' });
    }
    await channel.destroy();
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al eliminar canal.');
  }
});

router.patch('/suppliers/:id', async (req, res) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id);
    if (!supplier) {
      return res.status(404).json({ error: 'Proveedor no encontrado.' });
    }
    const updates = {};
    if (req.body?.active !== undefined) {
      updates.active = Boolean(req.body.active);
    }
    if (req.body?.priority !== undefined) {
      const p = Number.parseInt(String(req.body.priority), 10);
      if (Number.isFinite(p) && p >= 1) {
        updates.priority = p;
      }
    }
    await supplier.update(updates);
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al actualizar proveedor.');
  }
});

router.post('/suppliers/:id/balance', async (req, res) => {
  try {
    const balance = await refreshSupplierBalance(req.params.id);
    return res.json({ balance });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'No se pudo consultar el saldo del proveedor.'
    });
  }
});

router.post('/suppliers/:id/sync', async (req, res) => {
  try {
    const result = await syncSupplierCatalog(req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'No se pudo sincronizar el catálogo del proveedor.'
    });
  }
});

router.get('/suppliers/:id/health', async (req, res) => {
  try {
    const { adapter } = await getAdapterById(req.params.id);
    const result = await adapter.healthCheck();
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'No se pudo verificar la conexión con el proveedor.'
    });
  }
});

router.post('/suppliers/:id/auto-link', async (req, res) => {
  try {
    const [supplier, products, games, margins] = await Promise.all([
      Supplier.findByPk(req.params.id),
      SupplierProduct.findAll({ where: { supplierId: req.params.id, active: true } }),
      Game.findAll(),
      ProductMargin.findAll()
    ]);

    if (!supplier) {
      return res.status(404).json({ error: 'Proveedor no encontrado.' });
    }

    const usedMarginIds = new Set(
      products.filter((p) => p.localMarginId).map((p) => p.localMarginId)
    );

    let linkedCount = 0;
    for (const sp of products) {
      if (sp.localMarginId) {
        continue;
      }
      const patterns = extractProductPatterns(sp, games, margins);
      if (
        patterns.matchConfidence === 'high' &&
        patterns.suggestedMarginId &&
        !usedMarginIds.has(patterns.suggestedMarginId)
      ) {
        await sp.update({ localMarginId: patterns.suggestedMarginId });
        usedMarginIds.add(patterns.suggestedMarginId);
        linkedCount += 1;
      }
    }

    return res.json({ linkedCount });
  } catch (err) {
    return handleServerError(res, err, 'Error en auto-vinculación por patrones.');
  }
});

router.patch('/supplier-products/:id/link', async (req, res) => {
  try {
    const sp = await SupplierProduct.findByPk(req.params.id);
    if (!sp) {
      return res.status(404).json({ error: 'Producto de proveedor no encontrado.' });
    }
    const localMarginId = req.body?.localMarginId ? String(req.body.localMarginId).trim() : null;
    if (localMarginId) {
      const margin = await ProductMargin.findByPk(localMarginId);
      if (!margin) {
        return res.status(404).json({ error: 'Paquete local no encontrado.' });
      }
    }
    await sp.update({ localMarginId });
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al vincular producto.');
  }
});

router.post('/supplier-products/:id/import-margin', async (req, res) => {
  try {
    const sp = await SupplierProduct.findByPk(req.params.id);
    if (!sp) {
      return res.status(404).json({ error: 'Producto de proveedor no encontrado.' });
    }

    const [games, margins] = await Promise.all([Game.findAll(), ProductMargin.findAll()]);
    const patterns = extractProductPatterns(sp, games, margins);

    let targetGame = req.body?.gameId
      ? games.find((g) => g.id === String(req.body.gameId).trim())
      : patterns.detectedGameId
        ? games.find((g) => g.id === patterns.detectedGameId)
        : null;

    if (!targetGame) {
      const fallbackTitle = patterns.detectedGameTitle || sp.displayName.split(/\s+/)[0] || 'Nuevo Juego';
      const slug = fallbackTitle
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `game-${Date.now()}`;

      targetGame =
        games.find((g) => g.slug === slug) ||
        (await Game.create({
          id: slug,
          slug,
          title: fallbackTitle,
          publisher: 'Proveedor API',
          currencyName: sp.category === 'giftcard' ? 'Gift Card' : 'Créditos',
          category: sp.category === 'giftcard' ? 'giftcard' : 'topup',
          categoryLabel: sp.category === 'giftcard' ? 'Gift Card' : 'Top-Up por ID',
          badgeText: 'API Directo',
          deliverySpeed: 'Instantáneo',
          requiresZoneId: false,
          inputLabel: sp.category === 'giftcard' ? 'Correo para recibir PIN' : 'ID de Jugador',
          inputPlaceholder: sp.category === 'giftcard' ? 'tu-correo@ejemplo.com' : 'Ingresa tu ID',
          accentGradient: '#000000',
          accentColor: '#00D2FF',
          shortCode: fallbackTitle.slice(0, 3).toUpperCase(),
          isHot: false,
          active: true,
          sortOrder: games.length + 1
        }));
    }

    const baseCost = Number.parseFloat(String(sp.costPrice4 || '0'));
    const prices = computeSuggestedPrices(sp.costPrice4);
    const marginId = `${targetGame.id}-${Date.now().toString().slice(-5)}`;

    const createdMargin = await ProductMargin.create({
      id: marginId,
      gameId: targetGame.id,
      gameTitle: targetGame.title,
      packageLabel: String(req.body?.packageLabel || patterns.normalizedPackageLabel || sp.displayName).trim(),
      baseCostUsd: Number.isFinite(baseCost) ? Number(baseCost.toFixed(4)) : 0,
      publicPriceUsd: prices.suggestedPublicPriceUsd,
      resellerPriceUsd: prices.suggestedResellerPriceUsd,
      popular: false,
      active: true,
      apiEnabled: true,
      preferredSupplierId: sp.supplierId,
      externalProductId: sp.externalProductId
    });

    await sp.update({ localMarginId: createdMargin.id });

    return res.status(201).json({ marginId: createdMargin.id, gameId: targetGame.id });
  } catch (err) {
    return handleServerError(res, err, 'Error al importar producto a la tienda.');
  }
});

router.post('/orders/:id/fulfill', async (req, res) => {
  try {
    const result = await fulfillOrderWithPool(req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'Error al despachar la orden.'
    });
  }
});

router.post('/orders/:id/sync-status', async (req, res) => {
  try {
    const remote = await syncOrderStatusFromSupplier(req.params.id);
    return res.json({ remote });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'Error al consultar estado en proveedor.'
    });
  }
});

router.post('/hero-banners', async (req, res) => {
  try {
    const tagLeft = String(req.body?.tagLeft || '').trim();
    const tagRight = String(req.body?.tagRight || '').trim();
    const title = String(req.body?.title || '').trim();
    const accentWord = String(req.body?.accentWord || '').trim();
    const subtitle = String(req.body?.subtitle || '').trim();
    const ctaLabel = String(req.body?.ctaLabel || '').trim();

    if (!title || !accentWord || !subtitle || !ctaLabel) {
      return res.status(400).json({ error: 'Título, acento, subtítulo y texto del botón son obligatorios.' });
    }

    const baseId = `hero-${slugifyId(title) || Date.now()}`;
    const existing = await HeroBanner.findByPk(baseId);
    const id = existing ? `${baseId}-${Date.now().toString().slice(-4)}` : baseId;

    const created = await HeroBanner.create({
      id,
      tagLeft: tagLeft || 'NOVA COINS',
      tagRight: tagRight || 'TOP-UP DIRECTO',
      title,
      accentWord,
      subtitle,
      ctaLabel,
      action: req.body?.action === 'game' ? 'game' : 'catalog',
      targetGameId: req.body?.targetGameId ? String(req.body.targetGameId).trim() : null,
      badgeIcon: req.body?.badgeIcon === 'sparkles' ? 'sparkles' : 'zap',
      backgroundImage: req.body?.backgroundImage ? String(req.body.backgroundImage).trim() : null,
      sideHighlightTitle: String(req.body?.sideHighlightTitle || '').trim(),
      sideHighlightValue: String(req.body?.sideHighlightValue || '').trim(),
      sideHighlightNote: String(req.body?.sideHighlightNote || '').trim(),
      active: req.body?.active !== false,
      sortOrder: Number.parseInt(String(req.body?.sortOrder || '10'), 10) || 10
    });

    return res.status(201).json({ banner: created });
  } catch (err) {
    return handleServerError(res, err, 'Error al crear banner hero.');
  }
});

router.patch('/hero-banners/:id', async (req, res) => {
  try {
    const banner = await HeroBanner.findByPk(req.params.id);
    if (!banner) {
      return res.status(404).json({ error: 'Banner no encontrado.' });
    }

    const updates = {};
    const strFields = [
      'tagLeft',
      'tagRight',
      'title',
      'accentWord',
      'subtitle',
      'ctaLabel',
      'targetGameId',
      'backgroundImage',
      'sideHighlightTitle',
      'sideHighlightValue',
      'sideHighlightNote'
    ];
    for (const field of strFields) {
      if (req.body?.[field] !== undefined) {
        updates[field] = req.body[field] === null ? null : String(req.body[field]).trim();
      }
    }
    if (req.body?.action === 'game' || req.body?.action === 'catalog') {
      updates.action = req.body.action;
    }
    if (req.body?.badgeIcon === 'zap' || req.body?.badgeIcon === 'sparkles') {
      updates.badgeIcon = req.body.badgeIcon;
    }
    if (req.body?.active !== undefined) {
      updates.active = Boolean(req.body.active);
    }
    if (req.body?.sortOrder !== undefined) {
      const sortOrder = Number.parseInt(String(req.body.sortOrder), 10);
      if (Number.isFinite(sortOrder)) {
        updates.sortOrder = sortOrder;
      }
    }

    await banner.update(updates);
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al actualizar banner hero.');
  }
});

router.delete('/hero-banners/:id', async (req, res) => {
  try {
    const banner = await HeroBanner.findByPk(req.params.id);
    if (!banner) {
      return res.status(404).json({ error: 'Banner no encontrado.' });
    }
    await banner.destroy();
    return res.json({ ok: true });
  } catch (err) {
    return handleServerError(res, err, 'Error al eliminar banner hero.');
  }
});

module.exports = router;
