const {
  Game,
  HeroBanner,
  Order,
  PaymentChannel,
  ProductMargin,
  ResellerApplication,
  SavedId,
  Supplier,
  SupplierProduct,
  SystemConfig,
  User,
  WalletAdjustment
} = require('../models');
const logger = require('../utils/logger');
const {
  buildAdminAnalytics,
  buildPublicHeroBanners,
  formatAdminGame,
  formatAdminMargin,
  formatAdminPayment,
  formatAdminUser,
  formatChannel,
  formatHeroBanner,
  formatPublicChannel,
  formatResellerApplication,
  formatSupplier,
  formatSupplierProduct,
  formatWalletAdjustment
} = require('../utils/userPayload');
const { emitCatalogMargins, emitToAll, emitToSuperAdmin, emitUserUpdate } = require('./socket');

let hooksRegistered = false;

function runAfterCommit(options, task) {
  const execute = () => {
    Promise.resolve(task()).catch((err) => {
      logger.error(`Error en evento realtime de BD: ${err.message}`);
    });
  };
  if (options?.transaction && typeof options.transaction.afterCommit === 'function') {
    options.transaction.afterCommit(execute);
  } else {
    execute();
  }
}

function registerDatabaseRealtimeHooks() {
  if (hooksRegistered) {
    return;
  }
  hooksRegistered = true;

  Order.addHook('afterCreate', (order, options) => {
    runAfterCommit(options, async () => {
      const fullOrder = await Order.findByPk(order.id, {
        include: [{ model: User, attributes: ['fullName', 'role', 'email'] }]
      });
      if (fullOrder) {
        emitToSuperAdmin('admin:payment:upserted', {
          payment: formatAdminPayment(fullOrder)
        });
      }
      const analyticsData = await buildAdminAnalytics();
      emitToSuperAdmin('admin:analytics:updated', analyticsData);
      await emitUserUpdate(order.userId);
    });
  });

  Order.addHook('afterUpdate', (order, options) => {
    runAfterCommit(options, async () => {
      const fullOrder = await Order.findByPk(order.id, {
        include: [{ model: User, attributes: ['fullName', 'role', 'email'] }]
      });
      if (fullOrder) {
        emitToSuperAdmin('admin:payment:upserted', {
          payment: formatAdminPayment(fullOrder)
        });
      }
      const analyticsData = await buildAdminAnalytics();
      emitToSuperAdmin('admin:analytics:updated', analyticsData);
      await emitUserUpdate(order.userId);
    });
  });

  User.addHook('afterCreate', (user, options) => {
    runAfterCommit(options, () => {
      emitToSuperAdmin('admin:user:upserted', {
        user: formatAdminUser(user)
      });
    });
  });

  User.addHook('afterUpdate', (user, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:user:upserted', {
        user: formatAdminUser(user)
      });
      await emitUserUpdate(user.id);
    });
  });

  Game.addHook('afterCreate', (game, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:game:upserted', {
        game: formatAdminGame(game)
      });
      await emitCatalogMargins();
    });
  });

  Game.addHook('afterUpdate', (game, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:game:upserted', {
        game: formatAdminGame(game)
      });
      await emitCatalogMargins();
    });
  });

  Game.addHook('afterDestroy', (game, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:game:deleted', { id: game.id });
      await emitCatalogMargins();
    });
  });

  ProductMargin.addHook('afterCreate', (margin, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:margin:upserted', {
        margin: formatAdminMargin(margin)
      });
      await emitCatalogMargins();
    });
  });

  ProductMargin.addHook('afterUpdate', (margin, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:margin:upserted', {
        margin: formatAdminMargin(margin)
      });
      await emitCatalogMargins();
    });
  });

  ProductMargin.addHook('afterDestroy', (margin, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:margin:deleted', { id: margin.id });
      await emitCatalogMargins();
    });
  });

  PaymentChannel.addHook('afterCreate', (channel, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:channel:upserted', {
        channel: formatChannel(channel)
      });
      const activeChannels = await PaymentChannel.findAll({
        where: { active: true },
        order: [['priority', 'ASC'], ['name', 'ASC']]
      });
      emitToAll('catalog:channels', {
        channels: activeChannels.map(formatPublicChannel)
      });
    });
  });

  PaymentChannel.addHook('afterUpdate', (channel, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:channel:upserted', {
        channel: formatChannel(channel)
      });
      const activeChannels = await PaymentChannel.findAll({
        where: { active: true },
        order: [['priority', 'ASC'], ['name', 'ASC']]
      });
      emitToAll('catalog:channels', {
        channels: activeChannels.map(formatPublicChannel)
      });
    });
  });

  PaymentChannel.addHook('afterDestroy', (channel, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:channel:deleted', { id: channel.id });
      const activeChannels = await PaymentChannel.findAll({
        where: { active: true },
        order: [['priority', 'ASC'], ['name', 'ASC']]
      });
      emitToAll('catalog:channels', {
        channels: activeChannels.map(formatPublicChannel)
      });
    });
  });

  ResellerApplication.addHook('afterCreate', (app, options) => {
    runAfterCommit(options, () => {
      emitToSuperAdmin('admin:application:upserted', {
        application: formatResellerApplication(app)
      });
    });
  });

  ResellerApplication.addHook('afterUpdate', (app, options) => {
    runAfterCommit(options, () => {
      emitToSuperAdmin('admin:application:upserted', {
        application: formatResellerApplication(app)
      });
    });
  });

  WalletAdjustment.addHook('afterCreate', (adj, options) => {
    runAfterCommit(options, async () => {
      const fullAdj = await WalletAdjustment.findByPk(adj.id, {
        include: [
          { model: User, as: 'user', attributes: ['fullName', 'email'] },
          { model: User, as: 'admin', attributes: ['fullName', 'email'] }
        ]
      });
      if (fullAdj) {
        emitToSuperAdmin('admin:adjustment:created', {
          adjustment: formatWalletAdjustment(fullAdj)
        });
      }
    });
  });

  SystemConfig.addHook('afterSave', (config, options) => {
    if (config.key === 'paymentMode') {
      runAfterCommit(options, () => {
        emitToSuperAdmin('admin:paymentMode:updated', {
          paymentMode: config.value === 'auto' ? 'auto' : 'manual'
        });
      });
    } else if (config.key === 'whatsappNumber') {
      runAfterCommit(options, () => {
        const val = String(config.value || '').replace(/\D/g, '');
        emitToSuperAdmin('admin:whatsapp:updated', { whatsappNumber: val });
        emitToAll('catalog:whatsapp', { whatsappNumber: val });
      });
    }
  });

  SavedId.addHook('afterSave', (saved, options) => {
    runAfterCommit(options, () => emitUserUpdate(saved.userId));
  });

  SavedId.addHook('afterDestroy', (saved, options) => {
    runAfterCommit(options, () => emitUserUpdate(saved.userId));
  });

  Supplier.addHook('afterSave', (supplier, options) => {
    runAfterCommit(options, () => {
      emitToSuperAdmin('admin:supplier:upserted', {
        supplier: formatSupplier(supplier)
      });
    });
  });

  SupplierProduct.addHook('afterSave', (sp, options) => {
    runAfterCommit(options, () => {
      emitToSuperAdmin('admin:supplierProduct:upserted', {
        supplierProduct: formatSupplierProduct(sp)
      });
    });
  });

  HeroBanner.addHook('afterSave', (banner, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:heroBanner:upserted', {
        heroBanner: formatHeroBanner(banner)
      });
      const activeBanners = await buildPublicHeroBanners();
      emitToAll('catalog:heroBanners', { banners: activeBanners });
    });
  });

  HeroBanner.addHook('afterDestroy', (banner, options) => {
    runAfterCommit(options, async () => {
      emitToSuperAdmin('admin:heroBanner:deleted', { id: banner.id });
      const activeBanners = await buildPublicHeroBanners();
      emitToAll('catalog:heroBanners', { banners: activeBanners });
    });
  });

  logger.info('Hooks de tiempo real Sequelize -> Socket.IO registrados.');
}

module.exports = { registerDatabaseRealtimeHooks };
