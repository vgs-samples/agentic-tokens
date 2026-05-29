import { getStore } from "@netlify/blobs";
import { enrichCardSurface, enrichMissingCardSurfaces } from "../../server/card-surface.js";
import { json, wrap } from "./_lib.js";

// Mock merchant card store: buyerId → [{cardId, lastFour, brand?, savedAt}].
// Stands in for the customer's own card vault — we never store PAN/CVV.

export default wrap(async (req) => {
  const url = new URL(req.url);
  const match = url.pathname.match(/\/merchant\/cards\/?([^/?]+)?/);
  const buyerId = match?.[1];

  const store = getStore("agentic-merchant-cards");

  if (!buyerId && req.method === "GET") {
    const { blobs } = await store.list();
    const result = {};
    for (const { key } of blobs) {
      const value = await store.get(key, { type: "json" });
      if (Array.isArray(value?.cards)) {
        const enriched = await enrichMissingCardSurfaces(value.cards);
        if (enriched.changed) await store.setJSON(key, { cards: enriched.cards });
        result[key] = enriched.cards;
      }
    }
    return json(200, result);
  }

  if (!buyerId) return json(400, { error: "buyerId missing in path" });

  if (req.method === "GET") {
    const value = await store.get(buyerId, { type: "json" });
    const cards = value?.cards ?? [];
    const enriched = await enrichMissingCardSurfaces(cards);
    if (enriched.changed) await store.setJSON(buyerId, { cards: enriched.cards });
    return json(200, { buyerId, cards: enriched.cards });
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (!body.cardId) return json(400, { error: "cardId required" });
    const surface = await enrichCardSurface(body, { force: true });
    const current = await store.get(buyerId, { type: "json" });
    const existing = Array.isArray(current?.cards) ? current.cards : [];
    const next = existing.filter((c) => c.cardId !== body.cardId);
    next.unshift({
      cardId: surface.cardId,
      lastFour: surface.lastFour,
      brand: surface.brand,
      expMonth: surface.expMonth,
      expYear: surface.expYear,
      savedAt: Date.now(),
    });
    await store.setJSON(buyerId, { cards: next });
    return json(200, { buyerId, cards: next });
  }

  if (req.method === "DELETE") {
    const cardId = url.searchParams.get("cardId");
    const current = await store.get(buyerId, { type: "json" });
    const existing = Array.isArray(current?.cards) ? current.cards : [];

    if (cardId) {
      const next = existing.filter((c) => c.cardId !== cardId);
      const removed = next.length !== existing.length;
      if (next.length) await store.setJSON(buyerId, { cards: next });
      else await store.delete(buyerId);
      return json(200, { buyerId, cardId, deleted: removed });
    }

    await store.delete(buyerId);
    return json(200, { buyerId, deleted: existing.length > 0 });
  }

  return json(405, { error: `Method ${req.method} not allowed` });
});
