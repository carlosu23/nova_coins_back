const { Game, HeroBanner, PaymentChannel, ProductMargin, Supplier, SystemConfig } = require('../models');

const DEFAULT_GAMES = [
  {
    id: 'free-fire',
    slug: 'free-fire',
    title: 'Free Fire',
    publisher: 'Garena',
    currencyName: 'Diamantes',
    category: 'topup',
    categoryLabel: 'Top-Up por ID',
    badgeText: 'Top Ventas EC',
    deliverySpeed: 'Entrega < 5s',
    requiresZoneId: false,
    inputLabel: 'ID de Jugador (UID)',
    inputPlaceholder: 'Ej: 2491857302',
    accentGradient: '#000000',
    accentColor: '#F97316',
    shortCode: 'FF',
    logoUrl: '/images/free-fire-logo.svg',
    isHot: true,
    active: true,
    sortOrder: 1
  },
  {
    id: 'blood-strike',
    slug: 'blood-strike',
    title: 'Blood Strike',
    publisher: 'NetEase Games',
    currencyName: 'Oro',
    category: 'topup',
    categoryLabel: 'Top-Up por ID',
    badgeText: 'Entrega Rápida',
    deliverySpeed: 'Instantáneo',
    requiresZoneId: false,
    inputLabel: 'ID de Jugador',
    inputPlaceholder: 'Ej: 884012934',
    accentGradient: '#000000',
    accentColor: '#EF4444',
    shortCode: 'BS',
    logoUrl: '/images/blood-strike-logo.svg',
    isHot: true,
    active: true,
    sortOrder: 2
  },
  {
    id: 'roblox',
    slug: 'roblox',
    title: 'Roblox',
    publisher: 'Roblox Corp',
    currencyName: 'Gift Cards / Robux',
    category: 'giftcard',
    categoryLabel: 'Gift Card',
    badgeText: 'PIN Digital',
    deliverySpeed: 'Entrega Inmediata',
    requiresZoneId: false,
    inputLabel: 'Correo para recibir PIN',
    inputPlaceholder: 'tu-correo@ejemplo.com',
    accentGradient: '#000000',
    accentColor: '#00D2FF',
    shortCode: 'RBX',
    logoUrl: '/images/roblox-logo.webp',
    isHot: false,
    active: true,
    sortOrder: 3
  },
  {
    id: 'mobile-legends',
    slug: 'mobile-legends',
    title: 'Mobile Legends: Bang Bang',
    publisher: 'Moonton',
    currencyName: 'Diamantes',
    category: 'topup',
    categoryLabel: 'Top-Up por ID',
    badgeText: 'ID + Zone ID',
    deliverySpeed: 'Entrega < 5s',
    requiresZoneId: true,
    inputLabel: 'User ID',
    inputPlaceholder: 'Ej: 194827105',
    zonePlaceholder: 'Zone ID (Ej: 5201)',
    accentGradient: '#000000',
    accentColor: '#D946EF',
    shortCode: 'ML',
    logoUrl: '/images/mlbb-logo.webp',
    isHot: true,
    active: true,
    sortOrder: 4
  },
  {
    id: 'pubg-mobile',
    slug: 'pubg-mobile',
    title: 'PUBG Mobile',
    publisher: 'Tencent Games',
    currencyName: 'UC',
    category: 'topup',
    categoryLabel: 'Top-Up por ID',
    badgeText: 'Global UC',
    deliverySpeed: 'Entrega < 10s',
    requiresZoneId: false,
    inputLabel: 'Character ID',
    inputPlaceholder: 'Ej: 5192048172',
    accentGradient: '#000000',
    accentColor: '#FACC15',
    shortCode: 'UC',
    logoUrl: '/images/pubg-logo.svg',
    isHot: false,
    active: true,
    sortOrder: 5
  },
  {
    id: 'honor-of-kings',
    slug: 'honor-of-kings',
    title: 'Honor of Kings',
    publisher: 'Level Infinite',
    currencyName: 'Tokens',
    category: 'topup',
    categoryLabel: 'Top-Up por ID',
    badgeText: 'Nuevo',
    deliverySpeed: 'Instantáneo',
    requiresZoneId: false,
    inputLabel: 'Player ID (UID)',
    inputPlaceholder: 'Ej: 7710294812',
    accentGradient: '#000000',
    accentColor: '#F59E0B',
    shortCode: 'HOK',
    logoUrl: '/images/hok-logo.jpg',
    isHot: false,
    active: true,
    sortOrder: 6
  }
];

const DEFAULT_MARGINS = [

  { id: 'ff-100', gameId: 'free-fire', gameTitle: 'Free Fire', packageLabel: '100 + 10 Diamantes', bonus: '+10% Bonus', imageUrl: '/images/free-fire-diamonds.jpg', baseCostUsd: 0.85, publicPriceUsd: 1.15, resellerPriceUsd: 0.96, popular: false, sortOrder: 1 },
  { id: 'ff-310', gameId: 'free-fire', gameTitle: 'Free Fire', packageLabel: '310 + 31 Diamantes', bonus: '+10% Bonus', imageUrl: '/images/free-fire-diamonds.jpg', baseCostUsd: 2.65, publicPriceUsd: 3.35, resellerPriceUsd: 2.89, popular: true, sortOrder: 2 },
  { id: 'ff-520', gameId: 'free-fire', gameTitle: 'Free Fire', packageLabel: '520 + 52 Diamantes', bonus: '+10% Bonus', imageUrl: '/images/free-fire-vault.jpg', baseCostUsd: 4.35, publicPriceUsd: 5.5, resellerPriceUsd: 4.78, popular: false, sortOrder: 3 },
  { id: 'ff-1060', gameId: 'free-fire', gameTitle: 'Free Fire', packageLabel: '1,060 + 106 Diamantes', bonus: '+10% Bonus', imageUrl: '/images/free-fire-vault.jpg', baseCostUsd: 8.8, publicPriceUsd: 10.9, resellerPriceUsd: 9.45, popular: false, sortOrder: 4 },
  { id: 'ff-2180', gameId: 'free-fire', gameTitle: 'Free Fire', packageLabel: '2,180 + 218 Diamantes', bonus: 'VIP Pack', imageUrl: '/images/free-fire-chest.jpg', baseCostUsd: 17.6, publicPriceUsd: 21.8, resellerPriceUsd: 18.95, popular: false, sortOrder: 5 },
  { id: 'ff-5600', gameId: 'free-fire', gameTitle: 'Free Fire', packageLabel: '5,600 + 560 Diamantes', bonus: 'Mega Pack', imageUrl: '/images/free-fire-chest.jpg', baseCostUsd: 43.5, publicPriceUsd: 53.9, resellerPriceUsd: 46.8, popular: false, sortOrder: 6 },

  { id: 'bs-100', gameId: 'blood-strike', gameTitle: 'Blood Strike', packageLabel: '100 + 5 Oro', baseCostUsd: 0.78, publicPriceUsd: 0.99, resellerPriceUsd: 0.85, popular: false, sortOrder: 1 },
  { id: 'bs-300', gameId: 'blood-strike', gameTitle: 'Blood Strike', packageLabel: '300 + 20 Oro', bonus: '+20 Bonus', baseCostUsd: 2.3, publicPriceUsd: 2.95, resellerPriceUsd: 2.52, popular: true, sortOrder: 2 },
  { id: 'bs-500', gameId: 'blood-strike', gameTitle: 'Blood Strike', packageLabel: '500 + 40 Oro', bonus: '+40 Bonus', baseCostUsd: 3.85, publicPriceUsd: 4.89, resellerPriceUsd: 4.18, popular: false, sortOrder: 3 },
  { id: 'bs-1000', gameId: 'blood-strike', gameTitle: 'Blood Strike', packageLabel: '1,000 + 100 Oro', bonus: '+100 Bonus', baseCostUsd: 7.65, publicPriceUsd: 9.65, resellerPriceUsd: 8.3, popular: false, sortOrder: 4 },
  { id: 'bs-2000', gameId: 'blood-strike', gameTitle: 'Blood Strike', packageLabel: '2,000 + 260 Oro', bonus: 'Pro Pack', baseCostUsd: 15.2, publicPriceUsd: 19.2, resellerPriceUsd: 16.45, popular: false, sortOrder: 5 },
  { id: 'bs-5000', gameId: 'blood-strike', gameTitle: 'Blood Strike', packageLabel: '5,000 + 800 Oro', bonus: 'Elite Pack', baseCostUsd: 37.8, publicPriceUsd: 47.5, resellerPriceUsd: 40.9, popular: false, sortOrder: 6 },

  { id: 'rbx-10', gameId: 'roblox', gameTitle: 'Roblox', packageLabel: 'Gift Card $10 USD (800 Robux)', imageUrl: '/images/roblox-10.jpg', baseCostUsd: 9.25, publicPriceUsd: 10.5, resellerPriceUsd: 9.65, popular: true, sortOrder: 1 },
  { id: 'rbx-15', gameId: 'roblox', gameTitle: 'Roblox', packageLabel: 'Gift Card $15 USD (1,200 Robux)', imageUrl: '/images/roblox-15.jpg', baseCostUsd: 13.8, publicPriceUsd: 15.6, resellerPriceUsd: 14.4, popular: false, sortOrder: 2 },
  { id: 'rbx-25', gameId: 'roblox', gameTitle: 'Roblox', packageLabel: 'Gift Card $25 USD (2,000 Robux)', bonus: 'Más elegida', imageUrl: '/images/roblox-25.jpg', baseCostUsd: 22.9, publicPriceUsd: 25.8, resellerPriceUsd: 23.9, popular: false, sortOrder: 3 },
  { id: 'rbx-50', gameId: 'roblox', gameTitle: 'Roblox', packageLabel: 'Gift Card $50 USD (4,500 Robux)', bonus: '+10% Valor', imageUrl: '/images/roblox-50.jpg', baseCostUsd: 45.8, publicPriceUsd: 51.2, resellerPriceUsd: 47.6, popular: false, sortOrder: 4 },

  { id: 'ml-86', gameId: 'mobile-legends', gameTitle: 'Mobile Legends: Bang Bang', packageLabel: '78 + 8 Diamantes', baseCostUsd: 1.14, publicPriceUsd: 1.45, resellerPriceUsd: 1.24, popular: false, sortOrder: 1 },
  { id: 'ml-172', gameId: 'mobile-legends', gameTitle: 'Mobile Legends: Bang Bang', packageLabel: '156 + 16 Diamantes', baseCostUsd: 2.26, publicPriceUsd: 2.85, resellerPriceUsd: 2.46, popular: false, sortOrder: 2 },
  { id: 'ml-257', gameId: 'mobile-legends', gameTitle: 'Mobile Legends: Bang Bang', packageLabel: '234 + 23 Diamantes', bonus: 'Popular', baseCostUsd: 3.4, publicPriceUsd: 4.25, resellerPriceUsd: 3.68, popular: true, sortOrder: 3 },
  { id: 'ml-706', gameId: 'mobile-legends', gameTitle: 'Mobile Legends: Bang Bang', packageLabel: '625 + 81 Diamantes', bonus: '+81 Bonus', baseCostUsd: 9.1, publicPriceUsd: 11.4, resellerPriceUsd: 9.85, popular: false, sortOrder: 4 },
  { id: 'ml-2195', gameId: 'mobile-legends', gameTitle: 'Mobile Legends: Bang Bang', packageLabel: '1,860 + 335 Diamantes', bonus: 'Mythic Pack', baseCostUsd: 27.5, publicPriceUsd: 34.5, resellerPriceUsd: 29.8, popular: false, sortOrder: 5 },

  { id: 'pubg-60', gameId: 'pubg-mobile', gameTitle: 'PUBG Mobile', packageLabel: '60 UC', baseCostUsd: 0.8, publicPriceUsd: 0.99, resellerPriceUsd: 0.87, popular: false, sortOrder: 1 },
  { id: 'pubg-325', gameId: 'pubg-mobile', gameTitle: 'PUBG Mobile', packageLabel: '300 + 25 UC', bonus: '+25 UC', baseCostUsd: 3.95, publicPriceUsd: 4.85, resellerPriceUsd: 4.25, popular: true, sortOrder: 2 },
  { id: 'pubg-660', gameId: 'pubg-mobile', gameTitle: 'PUBG Mobile', packageLabel: '600 + 60 UC', bonus: 'Royale Pass', baseCostUsd: 7.85, publicPriceUsd: 9.65, resellerPriceUsd: 8.45, popular: false, sortOrder: 3 },
  { id: 'pubg-1800', gameId: 'pubg-mobile', gameTitle: 'PUBG Mobile', packageLabel: '1,500 + 300 UC', bonus: '+300 UC', baseCostUsd: 19.6, publicPriceUsd: 23.9, resellerPriceUsd: 21.1, popular: false, sortOrder: 4 },
  { id: 'pubg-3850', gameId: 'pubg-mobile', gameTitle: 'PUBG Mobile', packageLabel: '3,000 + 850 UC', bonus: 'Elite UC', baseCostUsd: 39.2, publicPriceUsd: 47.9, resellerPriceUsd: 42.3, popular: false, sortOrder: 5 },

  { id: 'hok-80', gameId: 'honor-of-kings', gameTitle: 'Honor of Kings', packageLabel: '80 Tokens', baseCostUsd: 0.79, publicPriceUsd: 0.99, resellerPriceUsd: 0.86, popular: false, sortOrder: 1 },
  { id: 'hok-240', gameId: 'honor-of-kings', gameTitle: 'Honor of Kings', packageLabel: '240 + 16 Tokens', baseCostUsd: 2.35, publicPriceUsd: 2.95, resellerPriceUsd: 2.55, popular: false, sortOrder: 2 },
  { id: 'hok-400', gameId: 'honor-of-kings', gameTitle: 'Honor of Kings', packageLabel: '400 + 32 Tokens', bonus: 'Popular', baseCostUsd: 3.9, publicPriceUsd: 4.9, resellerPriceUsd: 4.22, popular: true, sortOrder: 3 },
  { id: 'hok-800', gameId: 'honor-of-kings', gameTitle: 'Honor of Kings', packageLabel: '800 + 80 Tokens', bonus: '+80 Bonus', baseCostUsd: 7.8, publicPriceUsd: 9.75, resellerPriceUsd: 8.4, popular: false, sortOrder: 4 },
  { id: 'hok-2400', gameId: 'honor-of-kings', gameTitle: 'Honor of Kings', packageLabel: '2,400 + 360 Tokens', bonus: 'Grandmaster', baseCostUsd: 23.2, publicPriceUsd: 28.9, resellerPriceUsd: 25.1, popular: false, sortOrder: 5 }
];

const DEFAULT_CHANNELS = [
  {
    id: 'ch-binance',
    name: 'Binance Pay (USDT / USDC 1:1)',
    accountDetail: 'Acreditación instantánea 24/7',
    active: true,
    priority: 'Principal'
  },
  {
    id: 'ch-deuna',
    name: 'Deuna! QR Ecuador',
    accountDetail: 'Cuenta recaudadora principal · Ecuador',
    active: true,
    priority: 'Principal'
  },
  {
    id: 'ch-pichincha',
    name: 'Banco Pichincha',
    accountDetail: 'Cuenta Corriente · Validación por referencia',
    active: true,
    priority: 'Principal'
  },
  {
    id: 'ch-guayaquil',
    name: 'Banco Guayaquil',
    accountDetail: 'Cuenta Ahorros · Validación por referencia',
    active: true,
    priority: 'Respaldo'
  },
  {
    id: 'ch-produbanco',
    name: 'Produbanco',
    accountDetail: 'Cuenta Corriente · Respaldo local',
    active: false,
    priority: 'Respaldo'
  }
];

async function seedAdminData() {
  await SystemConfig.findOrCreate({
    where: { key: 'paymentMode' },
    defaults: { value: 'manual' }
  });

  for (const g of DEFAULT_GAMES) {
    await Game.findOrCreate({
      where: { id: g.id },
      defaults: g
    });
  }

  for (const m of DEFAULT_MARGINS) {
    const [row, created] = await ProductMargin.findOrCreate({
      where: { id: m.id },
      defaults: { ...m, active: true }
    });
    if (!created && !row.gameId) {
      await row.update({
        gameId: m.gameId,
        bonus: m.bonus || null,
        imageUrl: m.imageUrl || null,
        popular: Boolean(m.popular),
        sortOrder: m.sortOrder
      });
    }
  }

  for (const ch of DEFAULT_CHANNELS) {
    await PaymentChannel.findOrCreate({
      where: { id: ch.id },
      defaults: ch
    });
  }

  await Supplier.findOrCreate({
    where: { id: 'central-one' },
    defaults: {
      id: 'central-one',
      name: 'Central One Global',
      adapterType: 'central_one',
      baseUrl: process.env.CO_API_BASE_URL || 'https://portal.centraloneglobal.com/api/v1',
      active: true,
      priority: 1
    }
  });

  const DEFAULT_HERO_BANNERS = [
    {
      id: 'slide-topup',
      tagLeft: 'NOVA COINS',
      tagRight: 'FREE FIRE · TOP-UP ID',
      title: 'RECARGA DIAMANTES',
      accentWord: 'AL INSTANTE EN USD',
      subtitle: 'Entrega automática en menos de 5 segundos con Binance Pay 1:1, Deuna! y banca ecuatoriana.',
      ctaLabel: 'Recargar Free Fire',
      action: 'game',
      targetGameId: 'free-fire',
      badgeIcon: 'zap',
      backgroundImage: '/images/hero-freefire.jpg',
      sideHighlightTitle: 'PACK MÁS VENDIDO',
      sideHighlightValue: '310 + 31',
      sideHighlightNote: 'Diamantes · Entrega Inmediata',
      active: true,
      sortOrder: 1
    },
    {
      id: 'slide-giftcards',
      tagLeft: 'ECUADOR 100% USD',
      tagRight: 'GIFT CARDS & ROBUX',
      title: 'GiftCards de Roblox',
      accentWord: 'SIN COMISIONES OCULTAS',
      subtitle: 'Recibe tu PIN digital al instante o usa tu Billetera Prepago USD para comprar en 1 clic.',
      ctaLabel: 'Explorar Tienda',
      action: 'catalog',
      targetGameId: null,
      badgeIcon: 'sparkles',
      backgroundImage: '/images/hero-roblox.jpg',
      sideHighlightTitle: 'PASARELA HÍBRIDA',
      sideHighlightValue: '1:1 USD',
      sideHighlightNote: 'Binance Pay · Deuna! · Banca EC',
      active: true,
      sortOrder: 2
    },
    {
      id: 'slide-arena',
      tagLeft: 'TOP-UP DIRECTO',
      tagRight: 'MLBB · PUBG · BLOOD STRIKE',
      title: 'TUS JUEGOS FAVORITOS',
      accentWord: 'SIEMPRE DISPONIBLES 24/7',
      subtitle: 'Recarga automática 24/7 para que tus monedas lleguen directo a tu cuenta sin demoras.',
      ctaLabel: 'Ver Catálogo',
      action: 'catalog',
      targetGameId: null,
      badgeIcon: 'zap',
      backgroundImage: '/images/hero-arena.jpg',
      sideHighlightTitle: 'ENTREGA AUTOMÁTICA',
      sideHighlightValue: '< 5 SEG',
      sideHighlightNote: 'Directo a tu ID de Jugador',
      active: true,
      sortOrder: 3
    }
  ];

  for (const hb of DEFAULT_HERO_BANNERS) {
    await HeroBanner.findOrCreate({
      where: { id: hb.id },
      defaults: hb
    });
  }
}

module.exports = { seedAdminData };
