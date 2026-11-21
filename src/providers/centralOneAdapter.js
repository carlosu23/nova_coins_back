const crypto = require('node:crypto');
const logger = require('../utils/logger');
const { BaseSupplierAdapter, SupplierApiError } = require('./baseAdapter');

const RETRYABLE_CODES = new Set([
  'rate_limited',
  'internal_error',
  'service_unavailable',
  'maintenance_mode',
  'provider_unavailable'
]);

class CentralOneAdapter extends BaseSupplierAdapter {
  constructor(supplierConfig) {
    super(supplierConfig);
    this.apiKey = String(process.env.CO_API_KEY || '').trim();
    this.webhookSecret = String(process.env.CO_WEBHOOK_SECRET || '').trim();
    this.baseUrl = String(
      process.env.CO_API_BASE_URL || supplierConfig.baseUrl || 'https://portal.centraloneglobal.com/api/v1'
    ).replace(/\/+$/, '');
  }

  assertApiKey() {
    if (!this.apiKey) {
      throw new SupplierApiError('CO_API_KEY no configurada en el servidor.', {
        status: 500,
        code: 'missing_api_key',
        retryable: false
      });
    }
  }

  async request(path, { method = 'GET', body = null, headers = {}, requiresAuth = true } = {}) {
    if (requiresAuth) {
      this.assertApiKey();
    }

    const reqHeaders = {
      Accept: 'application/json',
      ...(body !== null ? { 'Content-Type': 'application/json' } : {}),
      ...(requiresAuth ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      ...headers
    };

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: reqHeaders,
      ...(body !== null ? { body: JSON.stringify(body) } : {})
    });

    const ipNotice = res.headers.get('x-centralone-ip-notice');
    if (ipNotice) {
      logger.warn(`[CentralOne] X-CentralOne-IP-Notice: ${ipNotice}`);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errObj = data?.error || {};
      const code = errObj.code || 'supplier_http_error';
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterSec = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;

      throw new SupplierApiError(errObj.message || `Central One HTTP ${res.status}`, {
        status: res.status,
        code,
        retryable: RETRYABLE_CODES.has(code) || res.status >= 500,
        retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : null,
        details: errObj
      });
    }

    return data;
  }

  async healthCheck() {
    const start = Date.now();
    const data = await this.request('/health', { requiresAuth: false });
    return {
      ok: data?.status === 'ok',
      latencyMs: Date.now() - start
    };
  }

  async fetchBalance() {
    const data = await this.request('/balance');
    return {
      availableBalance4: String(data.available_balance ?? '0.0000'),
      heldBalance4: String(data.held_balance ?? '0.0000'),
      totalBalance4: String(data.total_balance ?? '0.0000'),
      currency: String(data.currency || 'USD')
    };
  }

  async fetchCatalog({ lang = 'es' } = {}) {
    const data = await this.request(`/catalog?lang=${encodeURIComponent(lang)}`);
    const items = Array.isArray(data?.items) ? data.items : [];

    return items.map((item) => ({
      externalProductId: String(item.product_id),
      externalSku: item.sku ? String(item.sku) : null,
      externalFamilyId: item.product_family_id ? String(item.product_family_id) : null,
      name: String(item.name || ''),
      displayName: String(item.display_name || item.name || ''),
      category: item.product_type === 'gift_card' || item.category === 'gift_card' ? 'giftcard' : 'topup',
      currency: String(item.currency || 'USD'),
      costPrice4: String(item.reseller_price ?? '0.0000'),
      inStock: Boolean(item.in_stock),
      availableStock: item.available_stock === null || item.available_stock === undefined
        ? null
        : Number(item.available_stock),
      requiresTarget: Boolean(item.requires_target),
      targetSchema: Array.isArray(item.target_schema) ? item.target_schema : [],
      priceUpdatedAt: item.price_updated_at ? new Date(item.price_updated_at) : null,
      active: item.status === 'active'
    }));
  }

  async validatePlayer({ externalProductId, targetPayload }) {
    const data = await this.request('/player/validate', {
      method: 'POST',
      body: {
        product_id: externalProductId,
        target_payload: targetPayload || {}
      }
    });

    return {
      status: data.status || 'unverified',
      playerName: data.player?.name || null,
      reason: data.reason || null
    };
  }

  async createOrder({ idempotencyKey, items, note }) {
    const body = {
      items: items.map((it) => ({
        catalog_item_id: it.externalProductId,
        quantity: it.quantity || 1,
        ...(it.targetPayload && Object.keys(it.targetPayload).length > 0
          ? { target_payload: it.targetPayload }
          : {}),
        ...(it.expectedUnitPrice !== undefined
          ? { expected_unit_price: Number(it.expectedUnitPrice) }
          : {})
      })),
      ...(note ? { note: String(note).slice(0, 500) } : {})
    };

    const data = await this.request('/orders', {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey
      },
      body
    });

    const order = data.order || {};
    return {
      externalOrderId: order.id,
      referenceCode: order.reference_code,
      status: order.status || 'confirmed',
      totalSaleAmount4: String(order.total_sale_amount ?? '0.0000'),
      currency: String(order.currency || 'USD'),
      priceChanges: Array.isArray(data.price_changes) ? data.price_changes : []
    };
  }

  async getOrderStatus(externalOrderId) {
    const data = await this.request(`/orders/${encodeURIComponent(externalOrderId)}`);
    const order = data.order || {};
    return {
      externalOrderId: order.id,
      referenceCode: order.reference_code,
      status: order.status,
      items: Array.isArray(order.items)
        ? order.items.map((it) => ({
            id: it.id,
            productSku: it.product_sku,
            status: it.status,
            deliveredCount: Number(it.delivered_count || 0),
            failure: it.failure || null,
            refund: it.refund || null
          }))
        : [],
      refund: order.refund || null,
      failure: order.failure || null
    };
  }

  async getOrderCodes(externalOrderId) {
    const data = await this.request(`/orders/${encodeURIComponent(externalOrderId)}/codes`);
    const order = data.order || {};
    return {
      externalOrderId: order.order_id || externalOrderId,
      referenceCode: order.reference_code,
      items: Array.isArray(order.items)
        ? order.items.map((it) => ({
            id: it.id,
            productSku: it.product_sku,
            productName: it.product_name,
            codes: Array.isArray(it.codes) ? it.codes : []
          }))
        : []
    };
  }

  verifyWebhook({ headers, rawBody }) {
    if (!this.webhookSecret) {
      return { valid: false, reason: 'missing_webhook_secret' };
    }

    const timestamp = String(headers['x-centralone-timestamp'] || '').trim();
    const signature = String(headers['x-centralone-signature'] || '').trim();
    const prevSignature = String(headers['x-centralone-signature-previous'] || '').trim();

    if (!timestamp || !signature) {
      return { valid: false, reason: 'missing_signature_headers' };
    }

    const tsNum = Number.parseInt(timestamp, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > 300) {
      return { valid: false, reason: 'timestamp_expired' };
    }

    const rawString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', this.webhookSecret).update(`${timestamp}.${rawString}`).digest('hex');

    const matches = (candidate) => {
      if (!candidate) {
        return false;
      }
      const a = Buffer.from(expected);
      const b = Buffer.from(candidate);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    };

    if (matches(signature) || matches(prevSignature)) {
      return { valid: true };
    }

    return { valid: false, reason: 'invalid_signature' };
  }

  normalizeWebhookEvent(payload) {
    return {
      eventId: String(payload.event_id || ''),
      eventType: String(payload.event || ''),
      sequence: Number.isFinite(Number(payload.sequence)) ? Number(payload.sequence) : null,
      occurredAt: payload.occurred_at ? new Date(payload.occurred_at) : new Date(),
      order: payload.order || null,
      products: Array.isArray(payload.products) ? payload.products : [],
      balance: payload.balance || null,
      deposit: payload.deposit || null,
      credit: payload.credit || null
    };
  }
}

module.exports = { CentralOneAdapter };
