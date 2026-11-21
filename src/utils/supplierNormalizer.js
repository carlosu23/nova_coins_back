function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s.$+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeText(value) {
  return normalizeText(value)
    .split(/[\s.+]+/)
    .filter((token) => token.length >= 2);
}

function extractNumbers(value) {
  const matches = String(value || '').match(/\d+(?:[.,]\d+)?/g);
  if (!matches) {
    return [];
  }
  return matches.map((m) => m.replace(',', '.'));
}

function normalizeTargetSchema(rawSchema) {
  let parsed = rawSchema;
  if (typeof rawSchema === 'string') {
    try {
      parsed = JSON.parse(rawSchema || '[]');
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((field) => field && typeof field === 'object' && field.key)
    .map((field) => {
      const key = String(field.key).trim();
      const rawType = String(field.type || 'text').toLowerCase();
      const type =
        rawType === 'select' || Array.isArray(field.options) && field.options.length > 0
          ? 'select'
          : rawType === 'number' || rawType === 'integer'
            ? 'number'
            : rawType === 'email'
              ? 'email'
              : 'text';

      const options = Array.isArray(field.options)
        ? field.options
            .map((opt) => {
              if (opt && typeof opt === 'object') {
                const val = String(opt.value ?? opt.id ?? opt.label ?? '').trim();
                const lbl = String(opt.label ?? opt.name ?? opt.value ?? val).trim();
                return val ? { value: val, label: lbl || val } : null;
              }
              const s = String(opt || '').trim();
              return s ? { value: s, label: s } : null;
            })
            .filter(Boolean)
        : undefined;

      return {
        key,
        label: String(field.label || field.name || key).trim(),
        type,
        required: field.required !== false,
        placeholder: field.placeholder ? String(field.placeholder).trim() : undefined,
        ...(options && options.length > 0 ? { options } : {})
      };
    });
}

function extractTargetFieldsFromPayload({ targetPayload, playerId, zoneId }) {
  const cleanPayload = {};
  if (targetPayload && typeof targetPayload === 'object' && !Array.isArray(targetPayload)) {
    for (const [k, v] of Object.entries(targetPayload)) {
      const key = String(k || '').trim();
      const val = String(v ?? '').trim();
      if (key && val) {
        cleanPayload[key] = val;
      }
    }
  }

  const keys = Object.keys(cleanPayload);
  let resolvedPlayerId = String(playerId || '').trim();
  let resolvedZoneId = zoneId ? String(zoneId).trim() : null;

  if (!resolvedPlayerId && keys.length > 0) {
    const primaryKey =
      keys.find((k) => !/zone|server|region/i.test(k)) || keys[0];
    resolvedPlayerId = cleanPayload[primaryKey] || '';
  }

  if (!resolvedZoneId && keys.length > 1) {
    const zoneKey = keys.find((k) => /zone|server|region/i.test(k));
    if (zoneKey) {
      resolvedZoneId = cleanPayload[zoneKey] || null;
    }
  }

  return {
    targetPayload: Object.keys(cleanPayload).length > 0 ? cleanPayload : null,
    playerId: resolvedPlayerId,
    zoneId: resolvedZoneId
  };
}

const GAME_KEYWORD_HINTS = [
  { pattern: /free\s*fire|\bff\b/i, slug: 'free-fire', title: 'Free Fire', unit: 'Diamantes' },
  { pattern: /blood\s*strike|\bbs\b/i, slug: 'blood-strike', title: 'Blood Strike', unit: 'Oro' },
  { pattern: /roblox|robux|\brbx\b/i, slug: 'roblox', title: 'Roblox', unit: 'Gift Card' },
  { pattern: /mobile\s*legends|\bmlbb\b/i, slug: 'mobile-legends', title: 'Mobile Legends: Bang Bang', unit: 'Diamantes' },
  { pattern: /pubg|\buc\b/i, slug: 'pubg-mobile', title: 'PUBG Mobile', unit: 'UC' },
  { pattern: /honor\s*of\s*kings|\bhok\b/i, slug: 'honor-of-kings', title: 'Honor of Kings', unit: 'Tokens' },
  { pattern: /valorant|\bvp\b/i, slug: 'valorant', title: 'Valorant', unit: 'VP' },
  { pattern: /genshin/i, slug: 'genshin-impact', title: 'Genshin Impact', unit: 'Cristales' }
];

function computeSuggestedPrices(costPrice4) {
  const cost = Number.parseFloat(String(costPrice4 || '0'));
  if (!Number.isFinite(cost) || cost <= 0) {
    return {
      suggestedPublicPriceUsd: 1,
      suggestedResellerPriceUsd: 0.9
    };
  }
  const publicPrice = Math.max(Number((cost * 1.22).toFixed(2)), Number((cost + 0.1).toFixed(2)));
  const resellerPrice = Math.max(Number((cost * 1.1).toFixed(2)), Number((cost + 0.05).toFixed(2)));
  return {
    suggestedPublicPriceUsd: publicPrice,
    suggestedResellerPriceUsd: resellerPrice
  };
}

function extractProductPatterns(sp, games = [], margins = []) {
  const rawName = `${sp.displayName || ''} ${sp.name || ''}`.trim();
  const normalizedName = normalizeText(rawName);
  const spTokens = new Set(tokenizeText(`${rawName} ${sp.externalSku || ''}`));
  const spNumbers = extractNumbers(rawName);

  let detectedGame = null;
  for (const g of games) {
    const titleNorm = normalizeText(g.title);
    const slugNorm = normalizeText(g.slug).replace(/-/g, ' ');
    const codeNorm = normalizeText(g.shortCode);
    if (
      (titleNorm && normalizedName.includes(titleNorm)) ||
      (slugNorm && normalizedName.includes(slugNorm)) ||
      (codeNorm && codeNorm.length >= 2 && spTokens.has(codeNorm))
    ) {
      detectedGame = g;
      break;
    }
  }

  let detectedHint = null;
  if (!detectedGame) {
    for (const hint of GAME_KEYWORD_HINTS) {
      if (hint.pattern.test(rawName)) {
        detectedHint = hint;
        detectedGame =
          games.find(
            (g) => normalizeText(g.slug) === hint.slug || normalizeText(g.title).includes(normalizeText(hint.title))
          ) || null;
        break;
      }
    }
  }

  let bestMargin = null;
  let bestScore = 0;

  for (const m of margins) {
    let score = 0;
    if (detectedGame && m.gameId === detectedGame.id) {
      score += 45;
    } else if (detectedGame && normalizeText(m.gameTitle) === normalizeText(detectedGame.title)) {
      score += 40;
    } else {
      const mGameNorm = normalizeText(m.gameTitle);
      if (mGameNorm && normalizedName.includes(mGameNorm)) {
        score += 35;
      }
    }

    const mNumbers = extractNumbers(m.packageLabel);
    if (spNumbers.length > 0 && mNumbers.length > 0) {
      if (spNumbers[0] === mNumbers[0]) {
        score += 40;
      } else if (mNumbers.some((n) => spNumbers.includes(n))) {
        score += 20;
      }
    }

    const mTokens = tokenizeText(m.packageLabel);
    let shared = 0;
    for (const t of mTokens) {
      if (spTokens.has(t)) {
        shared += 1;
      }
    }
    score += Math.min(20, shared * 5);

    if (score > bestScore) {
      bestScore = score;
      bestMargin = m;
    }
  }

  const matchConfidence = bestScore >= 75 ? 'high' : bestScore >= 45 ? 'medium' : 'none';
  const prices = computeSuggestedPrices(sp.costPrice4);

  return {
    detectedGameId: detectedGame ? detectedGame.id : undefined,
    detectedGameTitle: detectedGame ? detectedGame.title : detectedHint ? detectedHint.title : undefined,
    detectedNumbers: spNumbers,
    normalizedPackageLabel: String(sp.displayName || sp.name || '').trim(),
    suggestedMarginId: matchConfidence !== 'none' && bestMargin ? bestMargin.id : undefined,
    suggestedMarginLabel:
      matchConfidence !== 'none' && bestMargin
        ? `${bestMargin.gameTitle} · ${bestMargin.packageLabel}`
        : undefined,
    matchConfidence,
    matchScore: bestScore,
    ...prices
  };
}

module.exports = {
  normalizeTargetSchema,
  extractTargetFieldsFromPayload,
  extractProductPatterns,
  computeSuggestedPrices
};
