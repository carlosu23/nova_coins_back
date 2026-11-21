class SupplierApiError extends Error {
  constructor(message, { status = 500, code = 'supplier_error', retryable = false, retryAfterSec = null, details = null } = {}) {
    super(message);
    this.name = 'SupplierApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSec = retryAfterSec;
    this.details = details;
  }
}

class BaseSupplierAdapter {
  constructor(supplierConfig) {
    this.supplierId = supplierConfig.id;
    this.name = supplierConfig.name;
    this.baseUrl = String(supplierConfig.baseUrl || '').replace(/\/+$/, '');
  }

  async healthCheck() {
    throw new Error(`${this.supplierId}: healthCheck() no implementado.`);
  }

  async fetchBalance() {
    throw new Error(`${this.supplierId}: fetchBalance() no implementado.`);
  }

  async fetchCatalog() {
    throw new Error(`${this.supplierId}: fetchCatalog() no implementado.`);
  }

  async validatePlayer() {
    return { status: 'unverified', playerName: null, reason: 'not_supported' };
  }

  async createOrder() {
    throw new Error(`${this.supplierId}: createOrder() no implementado.`);
  }

  async getOrderStatus() {
    throw new Error(`${this.supplierId}: getOrderStatus() no implementado.`);
  }

  async getOrderCodes() {
    return { externalOrderId: null, items: [] };
  }

  verifyWebhook() {
    return { valid: false, reason: 'not_implemented' };
  }

  normalizeWebhookEvent() {
    throw new Error(`${this.supplierId}: normalizeWebhookEvent() no implementado.`);
  }
}

module.exports = { BaseSupplierAdapter, SupplierApiError };
