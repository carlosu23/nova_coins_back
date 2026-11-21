const { User } = require('../models');
const logger = require('../utils/logger');
const { hashPassword } = require('../utils/password');

async function seedInitialSuperAdmin() {
  const existingAdmin = await User.findOne({ where: { role: 'Super Administrador' } });
  if (existingAdmin) {
    return;
  }

  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const fullName = String(process.env.ADMIN_NAME || 'Super Administrador').trim();
  const phone = String(process.env.ADMIN_PHONE || '+593 00 000 0000').trim();

  if (!email || password.length < 8) {
    logger.warn(
      'No existe ningún Super Administrador en la base de datos. Define ADMIN_EMAIL y ADMIN_PASSWORD (mín. 8 caracteres) para crear la cuenta inicial.'
    );
    return;
  }

  const existingByEmail = await User.findOne({ where: { email } });
  if (existingByEmail) {
    await existingByEmail.update({ role: 'Super Administrador', active: true });
    logger.info(`Usuario existente promovido a Super Administrador: ${email}`);
    return;
  }

  await User.create({
    fullName,
    email,
    phone,
    passwordHash: hashPassword(password),
    role: 'Super Administrador',
    walletBalanceUsd: 0,
    active: true
  });

  logger.info(`Cuenta inicial de Super Administrador creada: ${email}`);
}

module.exports = { seedInitialSuperAdmin };
