import { callVgs, config, hasCredentials } from "./vgs.js";

const BRAND_KEYS = [
  "card_brand",
  "brand",
  "cardBrand",
  "card_network",
  "cardNetwork",
  "payment_network",
  "paymentNetwork",
  "network",
  "scheme",
  "card_scheme",
  "cardScheme",
];

export async function enrichCardSurface(card, { force = false } = {}) {
  const surface = normalizeCardSurface(card);
  if (!surface.cardId || !hasCredentials() || (!force && !needsEnrichment(surface))) {
    return surface;
  }

  const apiSurface = await fetchVgsCardSurface(surface.cardId);
  if (!apiSurface) return surface;

  return {
    cardId: surface.cardId,
    lastFour: apiSurface.lastFour ?? surface.lastFour,
    brand: apiSurface.brand ?? surface.brand,
    expMonth: apiSurface.expMonth ?? surface.expMonth,
    expYear: apiSurface.expYear ?? surface.expYear,
  };
}

export async function enrichMissingCardSurfaces(cards) {
  const enriched = [];
  let changed = false;

  for (const card of cards) {
    const nextSurface = await enrichCardSurface(card);
    const next = { ...card, ...nextSurface };
    enriched.push(next);
    if (
      next.lastFour !== card.lastFour
      || next.brand !== card.brand
      || next.expMonth !== card.expMonth
      || next.expYear !== card.expYear
    ) {
      changed = true;
    }
  }

  return { cards: enriched, changed };
}

function normalizeCardSurface(card) {
  return {
    cardId: stringOrNull(card?.cardId ?? card?.id),
    lastFour: stringOrNull(card?.lastFour ?? card?.last4 ?? card?.last_4 ?? card?.last_four),
    brand: stringOrNull(card?.brand ?? card?.card_brand ?? card?.cardBrand),
    expMonth: formatMonth(card?.expMonth ?? card?.exp_month ?? card?.expiration_month),
    expYear: formatYear(card?.expYear ?? card?.exp_year ?? card?.expiration_year),
  };
}

function needsEnrichment(card) {
  return !card.lastFour || !card.brand || !card.expMonth || !card.expYear;
}

async function fetchVgsCardSurface(cardId) {
  const path = `/cards/${encodeURIComponent(cardId)}`;
  const baseUrls = [...new Set([config.cmpApiUrl, config.apiUrl].filter(Boolean))];

  for (const baseUrl of baseUrls) {
    try {
      const { status, data } = await callVgs(baseUrl, "GET", path);
      if (status >= 200 && status < 300) return surfaceFromVgsCard(data);
    } catch (err) {
      console.warn(`Could not enrich card ${cardId} from ${baseUrl}: ${err.message}`);
    }
  }

  return null;
}

function surfaceFromVgsCard(response) {
  const resource = response?.data?.data ?? response?.data ?? response;
  const attrs = resource?.attributes ?? {};
  return {
    cardId: stringOrNull(resource?.id),
    lastFour: stringOrNull(attrs.last4 ?? attrs.last_4 ?? attrs.last_four ?? attrs.lastFour),
    brand: findFirstStringByKey(attrs, BRAND_KEYS),
    expMonth: formatMonth(attrs.exp_month ?? attrs.expMonth ?? attrs.expiration_month),
    expYear: formatYear(attrs.exp_year ?? attrs.expYear ?? attrs.expiration_year),
  };
}

function findFirstStringByKey(source, keys) {
  for (const key of keys) {
    const value = stringOrNull(source?.[key]);
    if (value) return value;
  }
  return null;
}

function stringOrNull(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str || null;
}

function formatMonth(value) {
  const str = stringOrNull(value);
  return str ? str.padStart(2, "0").slice(-2) : null;
}

function formatYear(value) {
  const str = stringOrNull(value);
  return str ? str.slice(-2) : null;
}
