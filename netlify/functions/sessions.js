import { getStore } from "@netlify/blobs";
import { json, wrap } from "./_lib.js";

// MCP bridge: the browser POSTs the result of /collect.html or /binding.html
// here, and the MCP server polls until status === "completed".
//
// Stateless Functions need a persistent store; Express used an in-memory Map.
// Netlify Blobs gives us a managed KV with no extra infra.

const TTL_MS = 10 * 60 * 1000;

export default wrap(async (req) => {
  const url = new URL(req.url);
  const match = url.pathname.match(/\/sessions\/([^/]+)/);
  const id = match?.[1];
  if (!id) return json(400, { error: "session id missing in path" });

  const store = getStore("agentic-sessions");

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const completedAt = Date.now();
    await store.setJSON(id, { ...body, completedAt, expiresAt: completedAt + TTL_MS });
    return json(200, { ok: true });
  }

  if (req.method === "GET") {
    const session = await store.get(id, { type: "json" });
    if (!session) return json(404, { status: "pending" });
    if (session.expiresAt && Date.now() > session.expiresAt) {
      await store.delete(id);
      return json(404, { status: "pending" });
    }
    return json(200, { status: "completed", ...session });
  }

  return json(405, { error: `Method ${req.method} not allowed` });
});
