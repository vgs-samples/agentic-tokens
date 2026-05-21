import { getStore } from "@netlify/blobs";
import { json, wrap } from "./_lib.js";

// Payment requests are the bridge between deploy_site (which returns
// "payment_required") and authorize_subscription (which consumes the request,
// runs the VGS binding flow, and creates the subscription).
//
// Key: paymentRequestId. Value: { buyerId, amount, currency, reason, status,
// expiresAt, plus the binding-flow ids once authorized }.

const TTL_MS = 10 * 60 * 1000;

export default wrap(async (req) => {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/api\/payment-requests(?:\/([^/]+))?\/?$/);
  if (!match) return json(404, { error: "Not found" });
  const id = match[1];

  const store = getStore("agentic-payment-requests");

  if (req.method === "POST" && !id) {
    const body = await req.json().catch(() => ({}));
    if (!body.id) return json(400, { error: "id required" });
    const record = {
      id: body.id,
      buyerId: body.buyerId ?? null,
      amount: body.amount,
      currency: body.currency ?? "USD",
      plan: body.plan ?? null,
      reason: body.reason ?? null,
      siteId: body.siteId ?? null,
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
    };
    await store.setJSON(body.id, record);
    return json(200, record);
  }

  if (req.method === "GET" && id) {
    const record = await store.get(id, { type: "json" });
    if (!record) return json(404, { error: "Payment request not found" });
    if (record.expiresAt && Date.now() > record.expiresAt && record.status === "pending") {
      await store.delete(id);
      return json(404, { error: "Payment request expired" });
    }
    return json(200, record);
  }

  if (req.method === "PUT" && id) {
    const body = await req.json().catch(() => ({}));
    const record = await store.get(id, { type: "json" });
    if (!record) return json(404, { error: "Payment request not found" });
    const next = { ...record, ...body, id, updatedAt: Date.now() };
    await store.setJSON(id, next);
    return json(200, next);
  }

  if (req.method === "DELETE" && id) {
    await store.delete(id);
    return json(200, { id, deleted: true });
  }

  return json(405, { error: `Method ${req.method} not allowed` });
});
