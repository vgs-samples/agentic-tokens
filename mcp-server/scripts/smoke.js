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

const sampleParams = {
  brand: { emoji: "☕", name: "Acme Coffee Co" },
  themeColor: "amber",
  hero: {
    badge: "Свежая обжарка",
    headlineLines: ["Премиум кофе", "из лучших регионов —", "в вашу чашку"],
    tagline: "Single origin, обжарка под заказ, доставка по подписке.",
    primaryCta: "Оформить подписку",
    secondaryCta: "Узнать больше",
    usps: ["Single origin", "Обжарка под заказ", "Бесплатная доставка"],
  },
  stats: [
    { value: "100%", label: "Арабика" },
    { value: "48 ч", label: "От обжарки до вас" },
    { value: "300+", label: "Клиентов" },
    { value: "4.9 ★", label: "Средняя оценка" },
  ],
  about: {
    eyebrow: "О нас",
    headlineLines: ["Кофе с характером,", "обжаренный с душой"],
    paragraphs: ["Мы — небольшая обжарочная мастерская."],
    miniCards: [
      { icon: "🌱", title: "Single origin", subtitle: "Только лучшие зёрна" },
      { icon: "🔥", title: "Свежая обжарка", subtitle: "Перед каждой доставкой" },
    ],
  },
  why: {
    eyebrow: "Почему мы?",
    headline: "Разница — в каждой чашке",
    features: [
      { icon: "🌱", title: "Single origin", body: "..." },
      { icon: "🔥", title: "Свежая обжарка", body: "..." },
      { icon: "📦", title: "По подписке", body: "..." },
      { icon: "💰", title: "Честная цена", body: "..." },
      { icon: "🎁", title: "Подарок", body: "..." },
      { icon: "❤️", title: "Поддержка", body: "..." },
    ],
  },
  prices: {
    eyebrow: "Тарифы",
    headline: "Выберите свою подписку",
    subtitle: "—",
    popularBadge: "ХИТ",
    tiers: [
      { icon: "☕", name: "Дегустация", subtitle: "—", price: "500₽", unit: "/мес", bullets: ["250г", "Одно происхождение"], cta: "Выбрать" },
      { icon: "☕☕", name: "Стандарт", subtitle: "Самый популярный", price: "1 200₽", unit: "/мес", bullets: ["500г", "Два сорта", "Бесплатная доставка"], cta: "Выбрать" },
      { icon: "☕☕☕", name: "Premium", subtitle: "Для ценителей", price: "2 500₽", unit: "/мес", bullets: ["1 кг", "Эксклюзивные сорта", "Бесплатная доставка"], cta: "Выбрать" },
    ],
  },
  reviews: {
    eyebrow: "Отзывы",
    headline: "Что говорят клиенты",
    items: [
      { text: "Лучший кофе в моей жизни.", initial: "М", name: "Мария К.", city: "Москва" },
      { text: "Подписка — это удобно.", initial: "А", name: "Андрей П.", city: "СПб" },
      { text: "Премиум-класс.", initial: "Е", name: "Елена С.", city: "Казань" },
    ],
  },
  imageSeeds: { hero: "acme-coffee-hero", about: "acme-coffee-about" },
};

send({
  jsonrpc: "2.0", id: 3, method: "tools/call",
  params: { name: "publish_site", arguments: { params: sampleParams } },
});

await waitFor(() => messages.find((m) => m.id === 3), 4000);
child.kill();
backend.close();

const tools = messages.find((m) => m.id === 2);
const publishResult = messages.find((m) => m.id === 3);

const expectedTools = [
  "render_marketing_site", "publish_site", "authorize_subscription",
  "list_subscriptions", "cancel_subscription", "list_buyer_cards", "forget_card",
];
const gotTools = tools?.result?.tools?.map((t) => t.name).sort();
const missing = expectedTools.filter((t) => !gotTools?.includes(t));

if (
  !messages.find((m) => m.id === 1)?.result?.serverInfo
  || missing.length > 0
  || publishResult?.result?.structuredContent?.status !== "payment_required"
  || !publishResult?.result?.structuredContent?.paymentRequestId
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

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for response");
}
