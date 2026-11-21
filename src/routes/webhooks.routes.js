const express = require('express');
const { getAdapterById, processNormalizedWebhook } = require('../providers/supplierPool');
const logger = require('../utils/logger');

const router = express.Router();

router.post(
  '/suppliers/:supplierId',
  express.raw({ type: 'application/json', limit: '512kb' }),
  async (req, res) => {
    const supplierId = String(req.params.supplierId || '').trim();
    const rawBody = req.body;

    try {
      const { adapter } = await getAdapterById(supplierId);
      const verification = adapter.verifyWebhook({
        headers: req.headers,
        rawBody
      });

      if (!verification.valid) {
        logger.warn(`[Webhook ${supplierId}] Firma inválida: ${verification.reason}`);
        return res.status(401).json({ error: 'Firma de webhook inválida.' });
      }

      const parsed = JSON.parse(
        Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '{}')
      );

      res.status(200).json({ received: true });

      setImmediate(() => {
        processNormalizedWebhook(supplierId, parsed).catch((err) => {
          logger.error(`[Webhook ${supplierId}] Error procesando evento: ${err.message}`);
        });
      });
      return undefined;
    } catch (err) {
      logger.error(`[Webhook ${supplierId}] Error: ${err.message}`);
      return res.status(400).json({ error: 'Webhook inválido.' });
    }
  }
);

module.exports = router;
