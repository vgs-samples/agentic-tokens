import { getStore } from "@netlify/blobs";
import { json, wrap } from "./_lib.js";

// Subscriptions per buyer.
// Key: buyerId. Value: { plan, amount, currency, tokenId, intentId, cryptogramId, cardId,
//                        startedAt, expiresAt, status: "active" | "canceled" }
//
// Demo-only: a subscription is "active" if expiresAt > now and status === "active".
// We don't run real renewals — the existing 30-day intent window is enough.

export default wrap(async (req) => {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/api\/subscriptions(?:\/([^/]+))?\/?$/);
  if (!match) return json(404, { error: "Not found" });
  const buyerId = match[1];

  const store = getStore("agentic-subscriptions");

  if (req.method === "GET" && buyerId) {
    const sub = await store.get(buyerId, { type: "json" });
    if (!sub) return json(200, { buyerId, subscription: null });
    const expired = sub.expiresAt && Date.now() > sub.expiresAt;
    return json(200, {
      buyerId,
      subscription: { ...sub, active: !expired && sub.status === "active", expired },
    });
  }

  if (req.method === "POST" && buyerId) {
    const body = await req.json().catch(() => ({}));
    const record = {
      buyerId,
      plan: body.plan ?? "hosting-5usd-monthly",
      amount: body.amount ?? 5,
      currency: body.currency ?? "USD",
      cardId: body.cardId ?? null,
      tokenId: body.tokenId ?? null,
      intentId: body.intentId ?? null,
      cryptogramId: body.cryptogramId ?? null,
      startedAt: Date.now(),
      expiresAt: body.expiresAt ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
      status: "active",
    };
    await store.setJSON(buyerId, record);
    return json(200, { buyerId, subscription: { ...record, active: true } });
  }

  if (req.method === "DELETE" && buyerId) {
    const sub = await store.get(buyerId, { type: "json" });
    if (!sub) return json(200, { buyerId, deleted: false });
    await store.setJSON(buyerId, { ...sub, status: "canceled", canceledAt: Date.now() });
    return json(200, { buyerId, deleted: true });
  }

  return json(405, { error: `Method ${req.method} not allowed` });
});
