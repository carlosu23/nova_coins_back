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

const CHANNEL_COLORS = ['#FACC15', '#A855F7', '#00D2FF', '#22C55E', '#D946EF', '#F97316'];
const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function isApprovedOrderStatus(status) {
  return status === 'Aprobado' || status === 'Completado';
}

function estimateOrderProfit(order, marginById, marginByKey) {
  if (order.gameTitle === 'Fondeo de Billetera USD') {
    return 0;
  }
  const margin =
    (order.packageId ? marginById.get(order.packageId) : null) ||
    marginByKey.get(`${order.gameTitle}::${order.packageLabel}`);
  if (!margin) {
    return 0;
  }
  const profit = Number(order.amountUsd) - Number(margin.baseCostUsd);
  return Number.isFinite(profit) ? Math.max(0, Number(profit.toFixed(2))) : 0;
}

function formatTimeLabel(dateVal) {
  return new Date(dateVal).toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatAdminPayment(o) {
  let parsedCodes = undefined;
  if (o.deliveredCodes) {
    try {
      parsedCodes = JSON.parse(o.deliveredCodes);
    } catch {
      parsedCodes = undefined;
    }
  }
  return {
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
    supplierId: o.supplierId || undefined,
    externalOrderId: o.externalOrderId || undefined,
    externalReferenceCode: o.externalReferenceCode || undefined,
    fulfillmentStatus: o.fulfillmentStatus || 'none',
    failureMessage: o.failureMessage || undefined,
    deliveredCodes: parsedCodes,
    amountUsd: Number(o.amountUsd),
    status: o.status === 'Pendiente' || o.status === 'Rechazado' ? o.status : 'Aprobado',
    timeLabel: formatTimeLabel(o.createdAt)
  };
}

function formatAdminUser(u) {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    walletBalanceUsd: Number(u.walletBalanceUsd),
    active: Boolean(u.active)
  };
}

function formatAdminGame(g) {
  return {
    id: g.id,
    slug: g.slug,
    title: g.title,
    publisher: g.publisher,
    currencyName: g.currencyName,
    category: g.category,
    categoryLabel: g.categoryLabel,
    badgeText: g.badgeText,
    deliverySpeed: g.deliverySpeed,
    requiresZoneId: Boolean(g.requiresZoneId),
    inputLabel: g.inputLabel,
    inputPlaceholder: g.inputPlaceholder,
    zonePlaceholder: g.zonePlaceholder || undefined,
    accentGradient: g.accentGradient,
    accentColor: g.accentColor,
    shortCode: g.shortCode,
    logoUrl: g.logoUrl || undefined,
    isHot: Boolean(g.isHot),
    active: Boolean(g.active),
    sortOrder: g.sortOrder ?? 0
  };
}

function formatAdminMargin(m) {
  return {
    id: m.id,
    gameId: m.gameId || undefined,
    gameTitle: m.gameTitle,
    packageLabel: m.packageLabel,
    bonus: m.bonus || undefined,
    imageUrl: m.imageUrl || undefined,
    baseCostUsd: Number(m.baseCostUsd),
    publicPriceUsd: Number(m.publicPriceUsd),
    resellerPriceUsd: Number(m.resellerPriceUsd),
    popular: Boolean(m.popular),
    active: Boolean(m.active),
    apiEnabled: Boolean(m.apiEnabled)
  };
}

function formatChannel(c) {
  return {
    id: c.id,
    name: c.name,
    accountDetail: c.accountDetail,
    active: Boolean(c.active),
    priority: c.priority,
    qrImage: c.qrImage || undefined,
    publicKey: c.publicKey || undefined,
    hasPrivateKey: Boolean(c.privateKey)
  };
}

function formatPublicChannel(c) {
  return {
    id: c.id,
    name: c.name,
    accountDetail: c.accountDetail,
    priority: c.priority,
    qrImage: c.qrImage || undefined
  };
}

function formatResellerApplication(app) {
  return {
    id: app.id,
    referenceCode: app.referenceCode,
    fullName: app.fullName,
    businessName: app.businessName || undefined,
    email: app.email,
    phone: app.phone,
    monthlyVolume: app.monthlyVolume,
    message: app.message || undefined,
    adminNote: app.adminNote || undefined,
    status: app.status,
    timeLabel: formatTimeLabel(app.createdAt)
  };
}

function formatWalletAdjustment(adj) {
  return {
    id: adj.id,
    userName: adj.user?.fullName || 'Usuario',
    userEmail: adj.user?.email || '',
    adminName: adj.admin?.fullName || 'Administrador',
    type: adj.type,
    amountUsd: Number(adj.amountUsd),
    balanceAfterUsd: Number(adj.balanceAfterUsd),
    reason: adj.reason,
    timeLabel: formatTimeLabel(adj.createdAt)
  };
}

function formatSupplier(s) {
  return {
    id: s.id,
    name: s.name,
    adapterType: s.adapterType,
    baseUrl: s.baseUrl,
    active: Boolean(s.active),
    priority: Number(s.priority || 1),
    lastBalanceUsd: s.lastBalanceUsd || undefined,
    lastBalanceAt: s.lastBalanceAt ? formatTimeLabel(s.lastBalanceAt) : undefined,
    lastSyncAt: s.lastSyncAt ? formatTimeLabel(s.lastSyncAt) : undefined
  };
}

function formatSupplierProduct(sp) {
  return {
    id: sp.id,
    supplierId: sp.supplierId,
    externalProductId: sp.externalProductId,
    externalSku: sp.externalSku || undefined,
    name: sp.name,
    displayName: sp.displayName,
    category: sp.category,
    currency: sp.currency,
    costPrice4: sp.costPrice4,
    inStock: Boolean(sp.inStock),
    availableStock: sp.availableStock,
    requiresTarget: Boolean(sp.requiresTarget),
    active: Boolean(sp.active),
    localMarginId: sp.localMarginId || undefined
  };
}

function formatHeroBanner(b) {
  return {
    id: b.id,
    tagLeft: b.tagLeft,
    tagRight: b.tagRight,
    title: b.title,
    accentWord: b.accentWord,
    subtitle: b.subtitle,
    ctaLabel: b.ctaLabel,
    action: b.action === 'game' ? 'game' : 'catalog',
    targetGameId: b.targetGameId || undefined,
    badgeIcon: b.badgeIcon === 'sparkles' ? 'sparkles' : 'zap',
    backgroundImage: b.backgroundImage || undefined,
    sideHighlightTitle: b.sideHighlightTitle || '',
    sideHighlightValue: b.sideHighlightValue || '',
    sideHighlightNote: b.sideHighlightNote || '',
    active: Boolean(b.active),
    sortOrder: Number(b.sortOrder || 0)
  };
}

function formatGameRow(g, includeInactivePackages = false, onlyApiEnabled = false) {
  const packages = (g.packages || [])
    .filter((p) => (includeInactivePackages || p.active !== false) && (!onlyApiEnabled || p.apiEnabled === true))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || Number(a.publicPriceUsd) - Number(b.publicPriceUsd))
    .map((p) => ({
      id: p.id,
      gameId: p.gameId || g.id,
      label: p.packageLabel,
      bonus: p.bonus || undefined,
      imageUrl: p.imageUrl || undefined,
      baseCostUsd: includeInactivePackages ? Number(p.baseCostUsd) : undefined,
      publicPriceUsd: Number(p.publicPriceUsd),
      resellerPriceUsd: Number(p.resellerPriceUsd),
      popular: Boolean(p.popular),
      active: Boolean(p.active),
      apiEnabled: Boolean(p.apiEnabled),
      sortOrder: p.sortOrder ?? 0
    }));

  return {
    ...formatAdminGame(g),
    packages
  };
}

function computeAnalytics(allOrders, margins) {
  const marginById = new Map(margins.map((m) => [m.id, m]));
  const marginByKey = new Map(margins.map((m) => [`${m.gameTitle}::${m.packageLabel}`, m]));

  const approvedOrders = allOrders.filter((o) => isApprovedOrderStatus(o.status));
  const totalApprovedSalesUsd = Number(
    approvedOrders.reduce((sum, o) => sum + Number(o.amountUsd), 0).toFixed(2)
  );

  const today = new Date();
  const dayBuckets = [];
  const bucketMap = new Map();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(today);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - offset);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const entry = {
      day: WEEKDAY_LABELS[d.getDay()],
      ingresos: 0,
      ganancia: 0,
      ordenes: 0
    };
    dayBuckets.push(entry);
    bucketMap.set(key, entry);
  }

  const channelTotals = new Map();
  const gameTotals = new Map();

  for (const order of approvedOrders) {
    const amount = Number(order.amountUsd);
    const profit = estimateOrderProfit(order, marginById, marginByKey);
    const created = new Date(order.createdAt);
    const dayKey = `${created.getFullYear()}-${created.getMonth()}-${created.getDate()}`;
    const bucket = bucketMap.get(dayKey);
    if (bucket) {
      bucket.ingresos = Number((bucket.ingresos + amount).toFixed(2));
      bucket.ganancia = Number((bucket.ganancia + profit).toFixed(2));
      bucket.ordenes += 1;
    }

    const chName = order.paymentMethod || 'Otro';
    channelTotals.set(chName, Number(((channelTotals.get(chName) || 0) + amount).toFixed(2)));

    if (order.gameTitle !== 'Fondeo de Billetera USD') {
      const current = gameTotals.get(order.gameTitle) || { ventas: 0, ganancia: 0 };
      current.ventas = Number((current.ventas + amount).toFixed(2));
      current.ganancia = Number((current.ganancia + profit).toFixed(2));
      gameTotals.set(order.gameTitle, current);
    }
  }

  const paymentDistribution = Array.from(channelTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], idx) => ({
      name,
      value,
      color: CHANNEL_COLORS[idx % CHANNEL_COLORS.length]
    }));

  const topGamesRevenue = Array.from(gameTotals.entries())
    .sort((a, b) => b[1].ventas - a[1].ventas)
    .slice(0, 6)
    .map(([game, stats]) => ({
      game,
      ventas: stats.ventas,
      ganancia: stats.ganancia
    }));

  return {
    totalApprovedSalesUsd,
    analytics: {
      weeklyRevenue: dayBuckets,
      paymentDistribution,
      topGamesRevenue
    }
  };
}

async function buildAdminAnalytics() {
  const [allOrders, margins] = await Promise.all([
    Order.findAll({
      where: { isSandbox: false },
      attributes: [
        'packageId',
        'gameTitle',
        'packageLabel',
        'amountUsd',
        'paymentMethod',
        'status',
        'createdAt'
      ],
      order: [['createdAt', 'DESC']]
    }),
    ProductMargin.findAll({
      attributes: ['id', 'gameTitle', 'packageLabel', 'baseCostUsd']
    })
  ]);
  return computeAnalytics(allOrders, margins);
}

async function buildPublicCatalog() {
  const games = await Game.findAll({
    where: { active: true },
    include: [{ model: ProductMargin, as: 'packages', required: false }],
    order: [['sortOrder', 'ASC'], ['title', 'ASC']]
  });
  return games
    .map((g) => formatGameRow(g, false, false))
    .filter((g) => g.packages.length > 0);
}

async function buildPublicApiCatalog() {
  const games = await Game.findAll({
    where: { active: true },
    include: [{ model: ProductMargin, as: 'packages', required: false }],
    order: [['sortOrder', 'ASC'], ['title', 'ASC']]
  });
  return games
    .map((g) => formatGameRow(g, false, true))
    .filter((g) => g.packages.length > 0);
}

async function buildPublicHeroBanners() {
  const banners = await HeroBanner.findAll({
    where: { active: true },
    order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']]
  });
  return banners.map(formatHeroBanner);
}

async function buildUserPayload(userId) {
  const user = await User.findByPk(userId, {
    include: [
      { model: SavedId, as: 'savedIds' },
      { model: Order, as: 'orders', where: { isSandbox: false }, required: false }
    ],
    order: [
      [{ model: SavedId, as: 'savedIds' }, 'createdAt', 'DESC'],
      [{ model: Order, as: 'orders' }, 'createdAt', 'DESC']
    ]
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    walletBalanceUsd: Number(user.walletBalanceUsd),
    savedIds: (user.savedIds || []).map((s) => ({
      id: s.id,
      gameTitle: s.gameTitle,
      playerId: s.playerId,
      zoneId: s.zoneId || undefined,
      accountName: s.accountName || undefined,
      whatsapp: s.whatsapp || undefined
    })),
    recentOrders: (user.orders || []).map((o) => ({
      id: o.orderCode,
      gameTitle: o.gameTitle,
      packageLabel: o.packageLabel,
      playerId: o.playerId,
      amountUsd: Number(o.amountUsd),
      paymentMethod: o.paymentMethod,
      status: o.status,
      createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : undefined,
      dateLabel: formatTimeLabel(o.createdAt)
    }))
  };
}

async function buildAdminSnapshot() {
  const [
    configRow,
    recentOrders,
    allOrders,
    users,
    games,
    margins,
    channels,
    resellerApplications,
    walletAdjustments,
    suppliers,
    supplierProducts,
    heroBanners
  ] = await Promise.all([
    SystemConfig.findByPk('paymentMode'),
    Order.findAll({
      where: { isSandbox: false },
      include: [{ model: User, attributes: ['fullName', 'role', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit: 100
    }),
    Order.findAll({
      where: { isSandbox: false },
      attributes: [
        'packageId',
        'gameTitle',
        'packageLabel',
        'amountUsd',
        'paymentMethod',
        'status',
        'createdAt'
      ],
      order: [['createdAt', 'DESC']]
    }),
    User.findAll({ order: [['createdAt', 'ASC']] }),
    Game.findAll({
      include: [{ model: ProductMargin, as: 'packages', required: false }],
      order: [['sortOrder', 'ASC'], ['title', 'ASC']]
    }),
    ProductMargin.findAll({ order: [['gameTitle', 'ASC'], ['sortOrder', 'ASC'], ['publicPriceUsd', 'ASC']] }),
    PaymentChannel.findAll({ order: [['priority', 'ASC'], ['name', 'ASC']] }),
    ResellerApplication.findAll({ order: [['createdAt', 'DESC']], limit: 100 }),
    WalletAdjustment.findAll({
      include: [
        { model: User, as: 'user', attributes: ['fullName', 'email'] },
        { model: User, as: 'admin', attributes: ['fullName', 'email'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: 60
    }),
    Supplier.findAll({ order: [['priority', 'ASC'], ['name', 'ASC']] }),
    SupplierProduct.findAll({ order: [['supplierId', 'ASC'], ['displayName', 'ASC']], limit: 500 }),
    HeroBanner.findAll({ order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] })
  ]);

  const { totalApprovedSalesUsd, analytics } = computeAnalytics(allOrders, margins);

  return {
    paymentMode: configRow?.value === 'auto' ? 'auto' : 'manual',
    totalApprovedSalesUsd,
    analytics,
    payments: recentOrders.map(formatAdminPayment),
    users: users.map(formatAdminUser),
    games: games.map((g) => formatGameRow(g, true)),
    margins: margins.map(formatAdminMargin),
    channels: channels.map(formatChannel),
    resellerApplications: resellerApplications.map(formatResellerApplication),
    walletAdjustments: walletAdjustments.map(formatWalletAdjustment),
    suppliers: suppliers.map(formatSupplier),
    supplierProducts: supplierProducts.map(formatSupplierProduct),
    heroBanners: heroBanners.map(formatHeroBanner)
  };
}

module.exports = {
  buildUserPayload,
  buildAdminSnapshot,
  buildPublicCatalog,
  buildPublicApiCatalog,
  buildPublicHeroBanners,
  buildAdminAnalytics,
  formatAdminPayment,
  formatAdminUser,
  formatAdminGame,
  formatAdminMargin,
  formatChannel,
  formatPublicChannel,
  formatResellerApplication,
  formatWalletAdjustment,
  formatSupplier,
  formatSupplierProduct,
  formatHeroBanner
};
