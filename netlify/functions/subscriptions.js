import { getStore } from "@netlify/blobs";
import { json, wrap } from "./_lib.js";

// Payment wallet per buyer (blob endpoint name `/api/subscriptions/<buyerId>`
// kept for backward compatibility — conceptually this stores the buyer's
// TouchID-bound intent state, not a recurring subscription).
//
// Key: buyerId. Value: {
//   cardId, tokenId, intentId,                // VGS pointers
//   mandateQuantity, mandateUsed,             // how many $5 cryptograms remain on this intent
//   intentCreatedAt, intentExpiresAt,         // mandate lifetime
//   plan, amount, currency,                   // payment metadata
//   startedAt, updatedAt, lastChargedAt,
//   status: "active" | "canceled"
// }
//
// POST is upsert + merge — body fields override existing fields, missing fields are preserved.
// This is required so the MCP server can increment mandateUsed without re-supplying the
// whole record on every charge.

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
    const existing = (await store.get(buyerId, { type: "json" })) ?? {};
    const record = {
      ...existing,
      ...body,
      buyerId,
      startedAt: existing.startedAt ?? Date.now(),
      updatedAt: Date.now(),
      status: body.status ?? existing.status ?? "active",
    };
    await store.setJSON(buyerId, record);
    return json(200, { buyerId, subscription: { ...record, active: record.status === "active" } });
  }

  if (req.method === "DELETE" && buyerId) {
    const sub = await store.get(buyerId, { type: "json" });
    if (!sub) return json(200, { buyerId, deleted: false });
    await store.setJSON(buyerId, { ...sub, status: "canceled", canceledAt: Date.now() });
    return json(200, { buyerId, deleted: true });
  }

  return json(405, { error: `Method ${req.method} not allowed` });
});
