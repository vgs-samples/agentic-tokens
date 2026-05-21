// Stdio smoke test against a mock backend so the test runs without docker / Netlify.
// We spawn the stdio MCP entry point with a fake VGS Marketing Agency API base URL,
// intercept its outbound calls via a tiny in-process HTTP server, and check that the
// new tool surface behaves end-to-end through the protocol handshake.

import { spawn } from "node:child_process";
import { createServer } from "node:http";

const sites = new Map();
const subscriptions = new Map();
const paymentRequests = new Map();

const backend = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url, "http://localhost");

  function send(status, payload) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  }

  // /api/sites
  if (url.pathname === "/api/sites" && req.method === "POST") {
    const data = JSON.parse(body);
    sites.set(data.siteId, data);
    return send(200, { siteId: data.siteId, hasHtml: true, status: data.status });
  }
  const siteMatch = url.pathname.match(/^\/api\/sites\/([^/]+)$/);
  if (siteMatch) {
    const id = siteMatch[1];
    const site = sites.get(id);
    if (!site) return send(404, { error: "Site not found" });
    if (req.method === "GET") return send(200, site);
    if (req.method === "PUT") {
      const updates = JSON.parse(body);
      sites.set(id, { ...site, ...updates });
      return send(200, sites.get(id));
    }
  }

  // /api/subscriptions/:buyerId
  const subMatch = url.pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
  if (subMatch) {
    const buyerId = subMatch[1];
    if (req.method === "GET") {
      const sub = subscriptions.get(buyerId);
      return send(200, { buyerId, subscription: sub ? { ...sub, active: true } : null });
    }
    if (req.method === "POST") {
      const data = JSON.parse(body);
      subscriptions.set(buyerId, data);
      return send(200, { buyerId, subscription: { ...data, active: true } });
    }
  }

  // /api/payment-requests
  if (url.pathname === "/api/payment-requests" && req.method === "POST") {
    const data = JSON.parse(body);
    paymentRequests.set(data.id, { ...data, status: "pending" });
    return send(200, paymentRequests.get(data.id));
  }
  const prMatch = url.pathname.match(/^\/api\/payment-requests\/([^/]+)$/);
  if (prMatch) {
    const id = prMatch[1];
    if (req.method === "GET") {
      const pr = paymentRequests.get(id);
      if (!pr) return send(404, { error: "not found" });
      return send(200, pr);
    }
  }

  // /api/merchant/cards/:buyerId — return no cards so the smoke flow doesn't run the binding step
  if (/^\/api\/merchant\/cards\/[^/]+$/.test(url.pathname) && req.method === "GET") {
    return send(200, { buyerId: url.pathname.split("/").pop(), cards: [] });
  }

  send(404, { error: `mock backend has no route for ${req.method} ${url.pathname}` });
});

await new Promise((resolve) => backend.listen(0, resolve));
const port = backend.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath, ["src/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    AGENTIC_OPEN_BROWSER: "false",
    AGENTIC_APP_BASE_URL: baseUrl,
    AGENTIC_API_BASE_URL: `${baseUrl}/api`,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const messages = [];
let buffer = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    if (line.trim()) messages.push(JSON.parse(line));
  }
});
child.stderr.pipe(process.stderr);

send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1.0" } },
});

await waitFor(() => messages.find((m) => m.id === 1), 2000);

send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
send({
  jsonrpc: "2.0", id: 3, method: "tools/call",
  params: { name: "create_marketing_site", arguments: {
    companyName: "Acme Coffee Co",
    brief: "Premium hand-roasted beans, shipped weekly.",
    style: "modern",
  } },
});

await waitFor(() => messages.find((m) => m.id === 3), 4000);

const createResult = messages.find((m) => m.id === 3);
const siteId = createResult?.result?.structuredContent?.siteId;
if (!siteId) {
  console.error("create_marketing_site failed:", JSON.stringify(createResult, null, 2));
  cleanupAndExit(1);
}

send({
  jsonrpc: "2.0", id: 4, method: "tools/call",
  params: { name: "deploy_site", arguments: { siteId } },
});

await waitFor(() => messages.find((m) => m.id === 4), 4000);
child.kill();
backend.close();

const tools = messages.find((m) => m.id === 2);
const deployResult = messages.find((m) => m.id === 4);

const expectedTools = [
  "create_marketing_site", "deploy_site", "authorize_subscription",
  "list_subscriptions", "cancel_subscription", "list_buyer_cards", "forget_card",
];
const gotTools = tools?.result?.tools?.map((t) => t.name).sort();
const missing = expectedTools.filter((t) => !gotTools?.includes(t));

if (
  !messages.find((m) => m.id === 1)?.result?.serverInfo
  || missing.length > 0
  || !createResult?.result?.structuredContent?.siteId
  || deployResult?.result?.structuredContent?.status !== "payment_required"
) {
  console.error("Smoke checks failed.");
  console.error("Missing tools:", missing);
  console.error("Messages:", JSON.stringify(messages, null, 2));
  process.exit(1);
}
console.log(`MCP smoke test passed (tools: ${gotTools.join(", ")})`);

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function cleanupAndExit(code) {
  child.kill();
  backend.close();
  process.exit(code);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for response");
}
