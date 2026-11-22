const crypto = require('node:crypto');

function generateOrderCode(prefix) {
  const timePart = Date.now().toString(36).toUpperCase().slice(-5);
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${timePart}${randomPart}`;
}

module.exports = { generateOrderCode };
