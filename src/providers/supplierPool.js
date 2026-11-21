const { sequelize } = require('../config/database');
const {
  Order,
  ProductMargin,
  Supplier,
  SupplierProduct,
  User,
  WalletAdjustment,
  WebhookEventLog
} = require('../models');
const logger = require('../utils/logger');
const { CentralOneAdapter } = require('./centralOneAdapter');

const ADAPTER_FACTORIES = {
  central_one: (config) => new CentralOneAdapter(config)
};

function instantiateAdapter(supplierRow) {
  const factory = ADAPTER_FACTORIES[supplierRow.adapterType];
  if (!factory) {
    throw new Error(`Adaptador de proveedor no soportado: ${supplierRow.adapterType}`);
  }
  return factory(supplierRow);
}

async function getAdapterById(supplierId) {
  const supplier = await Supplier.findByPk(supplierId);
  if (!supplier) {
    throw new Error(`Proveedor ${supplierId} no encontrado.`);
  }
  return { supplier, adapter: instantiateAdapter(supplier) };
}

async function refreshSupplierBalance(supplierId) {
  const { supplier, adapter } = await getAdapterById(supplierId);
  const balance = await adapter.fetchBalance();
  await supplier.update({
    lastBalanceUsd: balance.availableBalance4,
    lastBalanceAt: new Date()
  });
  return balance;
}

async function syncSupplierCatalog(supplierId) {
  const { supplier, adapter } = await getAdapterById(supplierId);
  const normalizedItems = await adapter.fetchCatalog({ lang: 'es' });
  const now = new Date();

  const seenExternalIds = new Set();
  for (const item of normalizedItems) {
    seenExternalIds.add(item.externalProductId);
    const existing = await SupplierProduct.findOne({
      where: { supplierId, externalProductId: item.externalProductId }
    });
    const payload = {
      supplierId,
      externalProductId: item.externalProductId,
      externalSku: item.externalSku,
      externalFamilyId: item.externalFamilyId,
      name: item.name,
      displayName: item.displayName,
      category: item.category,
      currency: item.currency,
      costPrice4: item.costPrice4,
      inStock: item.inStock,
      availableStock: item.availableStock,
      requiresTarget: item.requiresTarget,
      targetSchemaJson: JSON.stringify(item.targetSchema || []),
      priceUpdatedAt: item.priceUpdatedAt,
      active: item.active
    };

    if (existing) {
      await existing.update(payload);
    } else {
      await SupplierProduct.create(payload);
    }
  }

  const allForSupplier = await SupplierProduct.findAll({ where: { supplierId } });
  for (const sp of allForSupplier) {
    if (!seenExternalIds.has(sp.externalProductId) && sp.active) {
      await sp.update({ active: false, inStock: false });
    }
  }

  await supplier.update({ lastSyncAt: now });
  return { count: normalizedItems.length, syncedAt: now.toISOString() };
}

function buildTargetPayloadForProduct(supplierProduct, rawPlayerId, rawZoneId, rawTargetPayload) {
  if (!supplierProduct.requiresTarget) {
    return undefined;
  }

  let schema = [];
  try {
    schema = JSON.parse(supplierProduct.targetSchemaJson || '[]');
  } catch {
    schema = [];
  }

  if (rawTargetPayload && typeof rawTargetPayload === 'object' && !Array.isArray(rawTargetPayload)) {
    const cleanMap = {};
    for (const [k, v] of Object.entries(rawTargetPayload)) {
      const key = String(k || '').trim();
      const val = String(v ?? '').trim();
      if (key && val) {
        cleanMap[key] = val;
      }
    }
    if (Object.keys(cleanMap).length > 0) {
      if (Array.isArray(schema) && schema.length > 0) {
        const mapped = {};
        for (const field of schema) {
          if (field.key && cleanMap[field.key]) {
            mapped[field.key] = cleanMap[field.key];
          }
        }
        if (Object.keys(mapped).length > 0) {
          return mapped;
        }
      }
      return cleanMap;
    }
  }

  const cleanPlayer = String(rawPlayerId || '').trim();
  const cleanZone = rawZoneId ? String(rawZoneId).trim() : '';

  if (Array.isArray(schema) && schema.length > 0) {
    const target = {};
    for (const field of schema) {
      const key = field.key;
      if (!key) {
        continue;
      }
      if (/zone|server|region/i.test(key)) {
        if (cleanZone) {
          target[key] = cleanZone;
        }
      } else {
        target[key] = cleanPlayer;
      }
    }
    return target;
  }

  return cleanZone
    ? { player_id: cleanPlayer, server: cleanZone }
    : { player_id: cleanPlayer };
}

async function validatePlayerWithPool({ packageId, playerId, zoneId, targetPayload }) {
  const candidates = await SupplierProduct.findAll({
    where: { localMarginId: packageId, active: true, inStock: true },
    include: [{ model: Supplier, where: { active: true } }],
    order: [[Supplier, 'priority', 'ASC']]
  });

  if (candidates.length === 0) {
    return { status: 'unverified', playerName: null, reason: 'no_supplier_linked' };
  }

  const chosen = candidates[0];
  if (!chosen.requiresTarget) {
    return { status: 'unverified', playerName: null, reason: 'product_takes_no_player_data' };
  }

  const adapter = instantiateAdapter(chosen.Supplier);
  const builtTarget = buildTargetPayloadForProduct(chosen, playerId, zoneId, targetPayload);
  return adapter.validatePlayer({
    externalProductId: chosen.externalProductId,
    targetPayload: builtTarget
  });
}

async function refundOrderToWalletIfNeeded(orderId, reason) {
  const tx = await sequelize.transaction();
  try {
    const order = await Order.findByPk(orderId, { transaction: tx, lock: tx.LOCK.UPDATE });
    if (!order || order.refundedToWallet || order.paymentMethod !== 'Billetera Nova USD') {
      await tx.commit();
      return false;
    }

    const user = await User.findByPk(order.userId, { transaction: tx, lock: tx.LOCK.UPDATE });
    if (!user) {
      await tx.commit();
      return false;
    }

    const refundAmount = Number(order.amountUsd);
    const nextBal = Number((Number(user.walletBalanceUsd) + refundAmount).toFixed(2));
    await user.update({ walletBalanceUsd: nextBal }, { transaction: tx });
    await order.update({ refundedToWallet: true }, { transaction: tx });

    await WalletAdjustment.create(
      {
        userId: user.id,
        adminId: user.id,
        type: 'credit',
        amountUsd: refundAmount,
        balanceAfterUsd: nextBal,
        reason: `Reembolso automático orden ${order.orderCode}: ${reason}`
      },
      { transaction: tx }
    );

    await tx.commit();
    logger.info(`Reembolso automático de $${refundAmount.toFixed(2)} USD aplicado a ${user.email} (${order.orderCode}).`);
    return true;
  } catch (err) {
    await tx.rollback().catch(() => {});
    logger.error(`Error en reembolso automático de orden ${orderId}: ${err.message}`);
    return false;
  }
}

async function resolvePoolCandidatesForOrder(order) {
  if (!order.packageId) {
    return [];
  }

  const linked = await SupplierProduct.findAll({
    where: { localMarginId: order.packageId, active: true, inStock: true },
    include: [{ model: Supplier, where: { active: true } }],
    order: [[Supplier, 'priority', 'ASC']]
  });

  if (linked.length > 0) {
    return linked;
  }

  const margin = await ProductMargin.findByPk(order.packageId);
  if (margin?.preferredSupplierId && margin?.externalProductId) {
    const direct = await SupplierProduct.findOne({
      where: {
        supplierId: margin.preferredSupplierId,
        externalProductId: margin.externalProductId,
        active: true
      },
      include: [{ model: Supplier, where: { active: true } }]
    });
    if (direct) {
      return [direct];
    }
  }

  return [];
}

async function fulfillOrderWithPool(orderId, { playerId, zoneId } = {}) {
  const order = await Order.findByPk(orderId);
  if (!order) {
    throw new Error('Orden no encontrada.');
  }

  if (order.externalOrderId && ['confirmed', 'processing', 'completed'].includes(order.fulfillmentStatus)) {
    return { skipped: true, reason: 'already_dispatched', externalOrderId: order.externalOrderId };
  }

  const candidates = await resolvePoolCandidatesForOrder(order);
  if (candidates.length === 0) {
    return { skipped: true, reason: 'no_supplier_linked' };
  }

  let resolvedPlayer = playerId;
  let resolvedZone = zoneId;
  if (!resolvedPlayer) {
    const match = /^(.+?)\s*\(([^)]+)\)$/.exec(order.playerId || '');
    if (match) {
      resolvedPlayer = match[1].trim();
      resolvedZone = resolvedZone || match[2].trim();
    } else {
      resolvedPlayer = order.playerId;
    }
  }

  let storedTargetPayload = null;
  if (order.targetPayloadJson) {
    try {
      storedTargetPayload = JSON.parse(order.targetPayloadJson);
    } catch {
      storedTargetPayload = null;
    }
  }

  let lastError = null;
  for (const candidate of candidates) {
    const adapter = instantiateAdapter(candidate.Supplier);
    const idempotencyKey = `nc-${order.id}-${candidate.supplierId}`.slice(0, 255);
    const targetPayload = buildTargetPayloadForProduct(
      candidate,
      resolvedPlayer,
      resolvedZone,
      storedTargetPayload
    );

    try {
      await order.update({
        supplierId: candidate.supplierId,
        idempotencyKey,
        fulfillmentStatus: 'processing',
        failureCode: null,
        failureMessage: null
      });

      const created = await adapter.createOrder({
        idempotencyKey,
        items: [
          {
            externalProductId: candidate.externalProductId,
            quantity: 1,
            targetPayload
          }
        ],
        note: `NovaCoins ${order.orderCode}`
      });

      await order.update({
        externalOrderId: created.externalOrderId,
        externalReferenceCode: created.referenceCode,
        fulfillmentStatus: created.status || 'confirmed'
      });

      return {
        dispatched: true,
        supplierId: candidate.supplierId,
        externalOrderId: created.externalOrderId,
        referenceCode: created.referenceCode,
        status: created.status
      };
    } catch (err) {
      lastError = err;
      logger.warn(
        `[SupplierPool] Falló despacho de ${order.orderCode} con ${candidate.supplierId}: ${err.code || err.message}`
      );
      const canFallback =
        err?.retryable ||
        err?.code === 'insufficient_stock' ||
        err?.code === 'out_of_stock' ||
        err?.code === 'provider_unavailable' ||
        err?.code === 'insufficient_balance';

      if (!canFallback) {
        break;
      }
    }
  }

  await order.update({
    fulfillmentStatus: 'failed',
    failureCode: lastError?.code || 'provider_error',
    failureMessage: lastError?.message || 'Error al despachar con proveedores.'
  });

  await refundOrderToWalletIfNeeded(order.id, lastError?.code || 'provider_error');
  throw lastError || new Error('No se pudo despachar la orden.');
}

async function syncOrderStatusFromSupplier(orderId) {
  const order = await Order.findByPk(orderId);
  if (!order || !order.supplierId || !order.externalOrderId) {
    throw new Error('La orden no tiene un despacho externo asociado.');
  }

  const { adapter } = await getAdapterById(order.supplierId);
  const remote = await adapter.getOrderStatus(order.externalOrderId);

  let codesList = null;
  const hasDeliverableCodes = remote.items?.some((it) => it.deliveredCount > 0);
  if (remote.status === 'completed' && hasDeliverableCodes) {
    try {
      const codesRes = await adapter.getOrderCodes(order.externalOrderId);
      const extracted = codesRes.items.flatMap((it) => it.codes || []);
      if (extracted.length > 0) {
        codesList = JSON.stringify(extracted);
      }
    } catch (err) {
      logger.warn(`No se pudieron leer códigos de ${order.orderCode}: ${err.message}`);
    }
  }

  const localStatus =
    remote.status === 'completed'
      ? 'Completado'
      : remote.status === 'failed' || remote.status === 'cancelled'
        ? 'Rechazado'
        : order.status;

  await order.update({
    fulfillmentStatus: remote.status || order.fulfillmentStatus,
    status: localStatus,
    ...(codesList ? { deliveredCodes: codesList } : {}),
    ...(remote.failure
      ? {
          failureCode: remote.failure.code || null,
          failureMessage: remote.failure.message_es || remote.failure.message || null
        }
      : {})
  });

  if (remote.status === 'failed' || remote.status === 'cancelled') {
    await refundOrderToWalletIfNeeded(order.id, remote.failure?.code || remote.status);
  }

  return remote;
}

async function processNormalizedWebhook(supplierId, rawEvent) {
  const { adapter } = await getAdapterById(supplierId);
  const event = adapter.normalizeWebhookEvent(rawEvent);

  if (!event.eventId || !event.eventType) {
    return { ignored: true, reason: 'invalid_event_payload' };
  }

  const [, created] = await WebhookEventLog.findOrCreate({
    where: { supplierId, eventId: event.eventId },
    defaults: {
      supplierId,
      eventId: event.eventId,
      eventName: event.eventType,
      sequence: event.sequence,
      orderReference: event.order?.reference_code || null,
      processedAt: new Date()
    }
  });

  if (!created) {
    return { deduplicated: true };
  }

  if (event.eventType.startsWith('order.') && event.order) {
    const refCode = event.order.reference_code;
    const idempKey = event.order.idempotency_key;
    const order = await Order.findOne({
      where: refCode
        ? { supplierId, externalReferenceCode: refCode }
        : { supplierId, idempotencyKey: idempKey }
    });

    if (order) {
      if (
        event.sequence !== null &&
        order.lastWebhookSequence !== null &&
        event.sequence <= order.lastWebhookSequence
      ) {
        return { ignored: true, reason: 'stale_sequence' };
      }

      const codesFromEvent = Array.isArray(event.order.codes)
        ? event.order.codes.flatMap((c) => c.codes || [])
        : [];

      const nextFulfillment =
        event.eventType === 'order.delivered'
          ? 'completed'
          : event.eventType === 'order.partially_delivered'
            ? 'partially_completed'
            : event.eventType === 'order.failed'
              ? 'failed'
              : event.eventType === 'order.refunded'
                ? 'refunded'
                : event.order.status || order.fulfillmentStatus;

      const nextLocalStatus =
        nextFulfillment === 'completed'
          ? 'Completado'
          : nextFulfillment === 'failed' || nextFulfillment === 'refunded'
            ? 'Rechazado'
            : order.status;

      await order.update({
        fulfillmentStatus: nextFulfillment,
        status: nextLocalStatus,
        lastWebhookSequence: event.sequence ?? order.lastWebhookSequence,
        ...(codesFromEvent.length > 0 ? { deliveredCodes: JSON.stringify(codesFromEvent) } : {}),
        ...(event.order.failure
          ? {
              failureCode: event.order.failure.code || null,
              failureMessage: event.order.failure.message_es || event.order.failure.message || null
            }
          : {})
      });

      if (nextFulfillment === 'failed' || nextFulfillment === 'refunded') {
        await refundOrderToWalletIfNeeded(order.id, event.order.failure?.code || nextFulfillment);
      }
    }
  } else if (
    (event.eventType === 'product.price_changed' || event.eventType === 'product.stock_changed') &&
    event.products.length > 0
  ) {
    for (const p of event.products) {
      const sp = await SupplierProduct.findOne({
        where: { supplierId, externalProductId: String(p.product_id) }
      });
      if (sp) {
        await sp.update({
          ...(p.reseller_price !== null && p.reseller_price !== undefined
            ? { costPrice4: String(p.reseller_price) }
            : {}),
          inStock: Boolean(p.in_stock),
          availableStock: p.available_stock ?? sp.availableStock,
          active: p.in_catalog !== false,
          priceUpdatedAt: p.price_updated_at ? new Date(p.price_updated_at) : sp.priceUpdatedAt
        });
      }
    }
  } else if (event.balance?.available) {
    await Supplier.update(
      { lastBalanceUsd: String(event.balance.available), lastBalanceAt: new Date() },
      { where: { id: supplierId } }
    );
  }

  return { processed: true, eventType: event.eventType };
}

module.exports = {
  getAdapterById,
  refreshSupplierBalance,
  syncSupplierCatalog,
  validatePlayerWithPool,
  fulfillOrderWithPool,
  syncOrderStatusFromSupplier,
  processNormalizedWebhook
};
