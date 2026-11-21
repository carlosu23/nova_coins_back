const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  fullName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  passwordHash: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('Super Administrador', 'Revendedor', 'Cliente'),
    allowNull: false,
    defaultValue: 'Cliente'
  },
  walletBalanceUsd: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  sandboxBalanceUsd: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 1000
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
});

const Game = sequelize.define('Game', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  slug: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  publisher: {
    type: DataTypes.STRING,
    allowNull: false
  },
  currencyName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  category: {
    type: DataTypes.ENUM('topup', 'giftcard'),
    allowNull: false,
    defaultValue: 'topup'
  },
  categoryLabel: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Top-Up por ID'
  },
  badgeText: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Entrega Rápida'
  },
  deliverySpeed: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Instantáneo'
  },
  requiresZoneId: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  inputLabel: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'ID de Jugador'
  },
  inputPlaceholder: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Ingresa tu ID'
  },
  zonePlaceholder: {
    type: DataTypes.STRING,
    allowNull: true
  },
  accentGradient: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '#000000'
  },
  accentColor: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '#FACC15'
  },
  shortCode: {
    type: DataTypes.STRING,
    allowNull: false
  },
  logoUrl: {
    type: DataTypes.STRING,
    allowNull: true
  },
  isHot: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  apiEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  preferredSupplierId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  externalProductId: {
    type: DataTypes.STRING,
    allowNull: true
  }
});

const SavedId = sequelize.define('SavedId', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  gameTitle: {
    type: DataTypes.STRING,
    allowNull: false
  },
  playerId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  zoneId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  accountName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  whatsapp: {
    type: DataTypes.STRING,
    allowNull: true
  }
});

const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  orderCode: {
    type: DataTypes.STRING,
    allowNull: false
  },
  packageId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  gameTitle: {
    type: DataTypes.STRING,
    allowNull: false
  },
  packageLabel: {
    type: DataTypes.STRING,
    allowNull: false
  },
  playerId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  amountUsd: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  paymentMethod: {
    type: DataTypes.STRING,
    allowNull: false
  },
  referenceCode: {
    type: DataTypes.STRING,
    allowNull: true
  },
  proofImage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  adminNote: {
    type: DataTypes.STRING,
    allowNull: true
  },
  processedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  externalOrderId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  supplierId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  externalReferenceCode: {
    type: DataTypes.STRING,
    allowNull: true
  },
  idempotencyKey: {
    type: DataTypes.STRING,
    allowNull: true
  },
  fulfillmentStatus: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'none'
  },
  deliveredCodes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  failureCode: {
    type: DataTypes.STRING,
    allowNull: true
  },
  failureMessage: {
    type: DataTypes.STRING,
    allowNull: true
  },
  targetPayloadJson: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  lastWebhookSequence: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  refundedToWallet: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  isSandbox: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Pendiente'
  }
});

const SystemConfig = sequelize.define('SystemConfig', {
  key: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  value: {
    type: DataTypes.STRING,
    allowNull: false
  }
});

const ProductMargin = sequelize.define('ProductMargin', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  gameId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  gameTitle: {
    type: DataTypes.STRING,
    allowNull: false
  },
  packageLabel: {
    type: DataTypes.STRING,
    allowNull: false
  },
  bonus: {
    type: DataTypes.STRING,
    allowNull: true
  },
  imageUrl: {
    type: DataTypes.STRING,
    allowNull: true
  },
  baseCostUsd: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  publicPriceUsd: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  resellerPriceUsd: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  popular: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  apiEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  preferredSupplierId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  externalProductId: {
    type: DataTypes.STRING,
    allowNull: true
  }
});

const PaymentChannel = sequelize.define('PaymentChannel', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  accountDetail: {
    type: DataTypes.STRING,
    allowNull: false
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  priority: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Principal'
  },
  qrImage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  publicKey: {
    type: DataTypes.STRING,
    allowNull: true
  },
  privateKey: {
    type: DataTypes.TEXT,
    allowNull: true
  }
});

const ResellerApplication = sequelize.define('ResellerApplication', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  referenceCode: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  fullName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  businessName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false
  },
  monthlyVolume: {
    type: DataTypes.STRING,
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  adminNote: {
    type: DataTypes.STRING,
    allowNull: true
  },
  reviewedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('Pendiente', 'Aprobada', 'Rechazada'),
    allowNull: false,
    defaultValue: 'Pendiente'
  }
});

const WalletAdjustment = sequelize.define('WalletAdjustment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  adminId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('credit', 'debit'),
    allowNull: false
  },
  amountUsd: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  balanceAfterUsd: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  reason: {
    type: DataTypes.STRING,
    allowNull: false
  }
});

const Supplier = sequelize.define('Supplier', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  adapterType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  baseUrl: {
    type: DataTypes.STRING,
    allowNull: false
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  priority: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  lastBalanceUsd: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lastBalanceAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastSyncAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  metadataJson: {
    type: DataTypes.TEXT,
    allowNull: true
  }
});

const SupplierProduct = sequelize.define('SupplierProduct', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  supplierId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  externalProductId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  externalSku: {
    type: DataTypes.STRING,
    allowNull: true
  },
  externalFamilyId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  displayName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'topup'
  },
  currency: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'USD'
  },
  costPrice4: {
    type: DataTypes.STRING,
    allowNull: false
  },
  inStock: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  availableStock: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  requiresTarget: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  targetSchemaJson: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  priceUpdatedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  localMarginId: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  indexes: [
    {
      unique: true,
      fields: ['supplierId', 'externalProductId']
    }
  ]
});

const WebhookEventLog = sequelize.define('WebhookEventLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  supplierId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  eventId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  eventName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  sequence: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  orderReference: {
    type: DataTypes.STRING,
    allowNull: true
  },
  processedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  indexes: [
    {
      unique: true,
      fields: ['supplierId', 'eventId']
    }
  ]
});

Supplier.hasMany(SupplierProduct, { foreignKey: 'supplierId', as: 'products', onDelete: 'CASCADE' });
SupplierProduct.belongsTo(Supplier, { foreignKey: 'supplierId' });

ProductMargin.hasMany(SupplierProduct, { foreignKey: 'localMarginId', as: 'supplierLinks' });
SupplierProduct.belongsTo(ProductMargin, { foreignKey: 'localMarginId', as: 'localMargin' });

const ApiKey = sequelize.define('ApiKey', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  keyPrefix: {
    type: DataTypes.STRING,
    allowNull: false
  },
  environment: {
    type: DataTypes.ENUM('production', 'sandbox'),
    allowNull: false,
    defaultValue: 'production'
  },
  keyHash: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  scopes: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'catalog:read,balance:read,orders:read,orders:write'
  },
  allowedIps: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  lastUsedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastUsedIp: {
    type: DataTypes.STRING,
    allowNull: true
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  revokedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
});

User.hasMany(ApiKey, { foreignKey: 'userId', as: 'apiKeys', onDelete: 'CASCADE' });
ApiKey.belongsTo(User, { foreignKey: 'userId', as: 'user' });

const HeroBanner = sequelize.define('HeroBanner', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  tagLeft: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tagRight: {
    type: DataTypes.STRING,
    allowNull: false
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  accentWord: {
    type: DataTypes.STRING,
    allowNull: false
  },
  subtitle: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  ctaLabel: {
    type: DataTypes.STRING,
    allowNull: false
  },
  action: {
    type: DataTypes.ENUM('game', 'catalog'),
    allowNull: false,
    defaultValue: 'catalog'
  },
  targetGameId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  badgeIcon: {
    type: DataTypes.ENUM('zap', 'sparkles'),
    allowNull: false,
    defaultValue: 'zap'
  },
  backgroundImage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sideHighlightTitle: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: ''
  },
  sideHighlightValue: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: ''
  },
  sideHighlightNote: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: ''
  },
  active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
});

Game.hasMany(ProductMargin, { foreignKey: 'gameId', as: 'packages', onDelete: 'CASCADE' });
ProductMargin.belongsTo(Game, { foreignKey: 'gameId' });

User.hasMany(SavedId, { foreignKey: 'userId', as: 'savedIds', onDelete: 'CASCADE' });
SavedId.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Order, { foreignKey: 'userId', as: 'orders', onDelete: 'CASCADE' });
Order.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(WalletAdjustment, { foreignKey: 'userId', as: 'walletAdjustments', onDelete: 'CASCADE' });
WalletAdjustment.belongsTo(User, { foreignKey: 'userId', as: 'user' });
WalletAdjustment.belongsTo(User, { foreignKey: 'adminId', as: 'admin' });

module.exports = {
  User,
  Game,
  SavedId,
  Order,
  SystemConfig,
  ProductMargin,
  PaymentChannel,
  ResellerApplication,
  WalletAdjustment,
  Supplier,
  SupplierProduct,
  WebhookEventLog,
  ApiKey,
  HeroBanner
};
