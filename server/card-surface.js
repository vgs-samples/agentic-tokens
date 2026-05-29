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
    debugCardSurface("skip-enrich", surface, { hasCardId: Boolean(surface.cardId), hasCredentials: hasCredentials(), force });
    return surface;
  }

  const apiSurface = await fetchVgsCardSurface(surface.cardId);
  debugCardSurface("vgs-enrich", surface, { apiSurface });
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
  const bin = stringOrNull(card?.bin);
  const first8 = stringOrNull(card?.first8);
  return {
    cardId: stringOrNull(card?.cardId ?? card?.id),
    lastFour: stringOrNull(card?.lastFour ?? card?.last4 ?? card?.last_4 ?? card?.last_four),
    brand: stringOrNull(card?.brand ?? card?.card_brand ?? card?.cardBrand) ?? inferCardBrandFromBin(first8 ?? bin),
    expMonth: formatMonth(card?.expMonth ?? card?.exp_month ?? card?.expiration_month),
    expYear: formatYear(card?.expYear ?? card?.exp_year ?? card?.expiration_year),
    bin,
    first8,
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
  console.log('response---->' , response)
  const resource = response?.data?.data ?? response?.data ?? response;
  const attrs = resource?.attributes ?? {};
  const bin = stringOrNull(attrs.bin);
  const first8 = stringOrNull(attrs.first8);
  return {
    cardId: stringOrNull(resource?.id),
    lastFour: stringOrNull(attrs.last4 ?? attrs.last_4 ?? attrs.last_four ?? attrs.lastFour),
    brand: findFirstStringByKey(attrs, BRAND_KEYS) ?? inferCardBrandFromBin(first8 ?? bin),
    expMonth: formatMonth(attrs.exp_month ?? attrs.expMonth ?? attrs.expiration_month),
    expYear: formatYear(attrs.exp_year ?? attrs.expYear ?? attrs.expiration_year),
  };
}

function inferCardBrandFromBin(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("4")) return "VISA";
  if (digits.length >= 2) {
    const first2 = Number(digits.slice(0, 2));
    if (first2 >= 51 && first2 <= 55) return "MASTERCARD";
    if (first2 === 34 || first2 === 37) return "AMERICAN-EXPRESS";
  }
  if (digits.length >= 4) {
    const first4 = Number(digits.slice(0, 4));
    if (first4 >= 2221 && first4 <= 2720) return "MASTERCARD";
    if (first4 === 6011) return "DISCOVER";
  }
  if (digits.length >= 3) {
    const first3 = Number(digits.slice(0, 3));
    if (first3 >= 644 && first3 <= 649) return "DISCOVER";
  }
  if (digits.startsWith("65")) return "DISCOVER";
  if (digits.startsWith("35")) return "JCB";
  if (digits.startsWith("62")) return "UNIONPAY";
  return null;
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

function debugCardSurface(stage, surface, extra = {}) {
  if (process.env.AGENTIC_DEBUG_CARD_SURFACE !== "true") return;
  console.log(`[card-surface:${stage}] ${JSON.stringify({ surface, ...extra })}`);
}
