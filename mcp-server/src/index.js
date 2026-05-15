#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { findProduct, searchCatalog } from "./catalog.js";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_APP_BASE_URL = "https://localhost:4200";
const DEFAULT_BUYER_ID = "demo-buyer";
const DEFAULT_CONSUMER_EMAIL = "user@example.com";
const DEFAULT_WAIT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_MS = 1500;

const appBaseUrl = normalizeBaseUrl(process.env.AGENTIC_APP_BASE_URL || DEFAULT_APP_BASE_URL);
const apiBaseUrl = normalizeBaseUrl(process.env.AGENTIC_API_BASE_URL || `${appBaseUrl}/api`);
const openBrowserEnabled = process.env.AGENTIC_OPEN_BROWSER !== "false";
const browserApp = process.env.AGENTIC_BROWSER_APP || defaultBrowserOverride();
const defaultBuyerId = process.env.AGENTIC_BUYER_ID || DEFAULT_BUYER_ID;
const defaultConsumerEmail = process.env.AGENTIC_CONSUMER_EMAIL || DEFAULT_CONSUMER_EMAIL;
const defaultEnvironment = process.env.AGENTIC_ENVIRONMENT || "sandbox";
const waitMs = Number.parseInt(process.env.AGENTIC_BROWSER_WAIT_MS || "", 10) || DEFAULT_WAIT_MS;
const pollMs = Number.parseInt(process.env.AGENTIC_POLL_MS || "", 10) || DEFAULT_POLL_MS;

if (/^https:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(appBaseUrl)) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= "0";
}

const purchases = new Map();

const tools = [
  {
    name: "search_products",
    title: "Search mock products",
    description: "Search the mock sneaker catalog by query, brand, and max price.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query, e.g. 'Nike sneakers under $150'." },
        brand: { type: "string", description: "Optional brand filter, e.g. Nike." },
        maxPrice: { type: "number", description: "Optional maximum item price in USD." },
        limit: { type: "number", description: "Maximum number of products to return." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "propose_purchase",
    title: "Prepare purchase approval",
    description: "Choose a product from the mock catalog and return a purchase handle plus exact user approval text.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language purchase request." },
        productId: { type: "string", description: "Optional exact product id returned by search_products." },
        brand: { type: "string", description: "Optional brand filter." },
        maxPrice: { type: "number", description: "Optional maximum price in USD." },
        buyerId: { type: "string", description: "Merchant-side buyer id. Defaults to demo-buyer." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "purchase_approved_product",
    title: "Purchase approved product",
    description: "After explicit user approval, collect a card if needed, run Visa authentication, create an intent, and return a payment cryptogram.",
    inputSchema: {
      type: "object",
      properties: {
        purchaseId: { type: "string", description: "Handle returned by propose_purchase." },
        approved: { type: "boolean", description: "Must be true only after the user explicitly approved the exact proposed product and price." },
        useExistingCard: { type: "boolean", description: "When the buyer already has a card on file, set true to reuse it or false to force fresh card collection. Defaults to true." },
        consumerEmail: { type: "string", description: "Consumer email used for token enrollment and OTP." },
        waitForBrowser: { type: "boolean", description: "Wait for browser collection/authentication flows. Defaults to true." },
      },
      required: ["purchaseId", "approved"],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "forget_card",
    title: "Forget stored card",
    description: "Remove the cached card mapping for a buyer so the next purchase will prompt for fresh card details.",
    inputSchema: {
      type: "object",
      properties: {
        buyerId: { type: "string", description: "Merchant-side buyer id. Defaults to demo-buyer." },
      },
      additionalProperties: false,
    },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
];

const handlers = {
  search_products: handleSearchProducts,
  propose_purchase: handleProposePurchase,
  purchase_approved_product: handlePurchaseApprovedProduct,
  forget_card: handleForgetCard,
};

const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (err) {
    log(`Ignoring invalid JSON-RPC line: ${err.message}`);
    return;
  }
  await handleMessage(message);
});

async function handleMessage(message) {
  if (Array.isArray(message)) {
    await Promise.all(message.map((item) => handleMessage(item)));
    return;
  }

  if (!message || typeof message !== "object") return;
  if (!("id" in message)) {
    if (message.method !== "notifications/initialized") {
      log(`Notification received: ${message.method ?? "unknown"}`);
    }
    return;
  }

  try {
    switch (message.method) {
      case "initialize":
        sendResult(message.id, {
          protocolVersion: message.params?.protocolVersion || MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agentic-tokens-mcp", version: "0.1.0" },
        });
        break;
      case "ping":
        sendResult(message.id, {});
        break;
      case "tools/list":
        sendResult(message.id, { tools });
        break;
      case "tools/call":
        sendResult(message.id, await callTool(message.params));
        break;
      default:
        sendError(message.id, -32601, `Method not found: ${message.method}`);
    }
  } catch (err) {
    sendError(message.id, -32000, err.message, { stack: err.stack });
  }
}

async function callTool(params = {}) {
  const name = params.name;
  const args = params.arguments || {};
  const handler = handlers[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  try {
    const structuredContent = await handler(args);
    return {
      content: [{ type: "text", text: formatToolText(name, structuredContent) }],
      structuredContent,
      isError: false,
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: err.message }],
      structuredContent: { error: err.message },
      isError: true,
    };
  }
}

async function handleSearchProducts(args) {
  const products = searchCatalog(args);
  return { products };
}

async function handleProposePurchase(args) {
  const product = args.productId ? findProduct(args.productId) : searchCatalog(args)[0];
  if (!product) {
    throw new Error("No matching in-stock product found in the mock catalog.");
  }

  const requestedMaxPrice = Number.isFinite(Number(args.maxPrice)) ? Number(args.maxPrice) : null;
  if (requestedMaxPrice !== null && product.price > requestedMaxPrice) {
    throw new Error(`${product.title} costs ${formatMoney(product)}, above requested max price ${requestedMaxPrice} USD.`);
  }

  const purchaseId = createId("purchase");
  const buyerId = args.buyerId || defaultBuyerId;
  const existingCardId = await getCardForBuyer(buyerId);
  const purchase = {
    id: purchaseId,
    buyerId,
    product,
    status: "awaiting_approval",
    createdAt: new Date().toISOString(),
  };
  purchases.set(purchaseId, purchase);

  const approvalText = `Approve purchase ${purchaseId}: ${product.title} (${product.color}) for ${formatMoney(product)} at ${product.merchantName}.`;
  const nextStep = existingCardId
    ? "Ask the user to approve the exact product and price, AND ask whether to use the card already on file or enter a new one. Then call purchase_approved_product with approved=true and useExistingCard=true|false."
    : "Ask the user to approve the exact product and price, then call purchase_approved_product with approved=true. They will be prompted to enter card details in a browser tab.";
  return {
    purchaseId,
    approvalRequired: true,
    approvalText,
    buyerId,
    product,
    existingCard: existingCardId ? { onFile: true } : null,
    nextStep,
  };
}

async function handlePurchaseApprovedProduct(args) {
  if (!args.approved) {
    throw new Error("Purchase was not approved by the user.");
  }
  const purchase = purchases.get(args.purchaseId);
  if (!purchase) {
    throw new Error(`Unknown purchaseId: ${args.purchaseId}`);
  }
  if (purchase.status === "completed") {
    return purchase.result;
  }

  const previousStatus = purchase.status;
  purchase.status = "running";
  const product = purchase.product;
  const buyerId = purchase.buyerId || defaultBuyerId;
  const consumerEmail = args.consumerEmail || defaultConsumerEmail;
  const waitForBrowser = args.waitForBrowser !== false;

  // Sticky flag — once the agent asks for a new card, force collection even on resume.
  if (args.useExistingCard === false) purchase.forceNewCard = true;

  let cardId = purchase.cardId ?? (purchase.forceNewCard ? null : await getCardForBuyer(buyerId));
  let collect = purchase.collect ?? null;
  if (!cardId && previousStatus === "waiting_for_card" && collect) {
    const cardSession = waitForBrowser
      ? await waitForSession(collect.sessionId, waitMs)
      : await apiFetch(`/sessions/${encodeURIComponent(collect.sessionId)}`, { allow404: true });
    if (!cardSession) {
      purchase.status = "waiting_for_card";
      return {
        status: "waiting_for_card",
        purchaseId: purchase.id,
        collect,
        message: "Open the collect URL and save a card.",
      };
    }
    cardId = cardSession.cardId;
    if (!cardId) throw new Error("Card collection completed without cardId.");
    purchase.cardId = cardId;
  }

  if (!cardId) {
    const sessionId = createId("collect");
    const collectUrl = buildAppUrl("/collect.html", { sessionId, buyer_id: buyerId });
    const opened = openBrowser(collectUrl);
    collect = { sessionId, url: collectUrl, opened };
    purchase.collect = collect;

    if (!waitForBrowser) {
      purchase.status = "waiting_for_card";
      return {
        status: "waiting_for_card",
        purchaseId: purchase.id,
        collect,
        message: "Open the collect URL, save a card, then call purchase_approved_product again.",
      };
    }

    const cardSession = await waitForSession(sessionId, waitMs);
    cardId = cardSession.cardId;
    if (!cardId) throw new Error("Card collection completed without cardId.");
    purchase.cardId = cardId;
  }

  let tokenId = purchase.tokenId;
  if (!tokenId) {
    const token = await enrollAgenticToken(cardId, consumerEmail);
    tokenId = token?.data?.id;
    if (!tokenId) {
      throw new Error(`Token enrollment returned no id: ${JSON.stringify(token)}`);
    }
    purchase.tokenId = tokenId;
  }

  let binding = purchase.binding ?? null;
  let assuranceData = purchase.assuranceData ?? null;
  if (!assuranceData && previousStatus === "waiting_for_authentication" && binding) {
    const bindingSession = waitForBrowser
      ? await waitForSession(binding.sessionId, waitMs)
      : await apiFetch(`/sessions/${encodeURIComponent(binding.sessionId)}`, { allow404: true });
    if (!bindingSession) {
      purchase.status = "waiting_for_authentication";
      return {
        status: "waiting_for_authentication",
        purchaseId: purchase.id,
        cardId,
        tokenId,
        collect,
        binding,
        message: "Open the binding URL and complete Visa authentication.",
      };
    }
    assuranceData = bindingSession.assuranceData;
    if (!assuranceData) throw new Error("Visa authentication completed without assuranceData.");
    purchase.assuranceData = assuranceData;
  }

  if (!assuranceData) {
    const bindingSessionId = createId("binding");
    const bindingUrl = buildAppUrl("/binding.html", {
      sessionId: bindingSessionId,
      buyer_id: buyerId,
      tokenId,
      product_name: product.title,
      merchant_name: product.merchantName,
      amount: formatAmount(product.price),
      currency: product.currency,
      currency_code: currencyNumericCode(product.currency),
      consumer_email: consumerEmail,
      environment: defaultEnvironment,
    });
    binding = { sessionId: bindingSessionId, url: bindingUrl, opened: openBrowser(bindingUrl) };
    purchase.binding = binding;
  }

  if (!assuranceData && !waitForBrowser) {
    purchase.status = "waiting_for_authentication";
    purchase.cardId = cardId;
    purchase.tokenId = tokenId;
    return {
      status: "waiting_for_authentication",
      purchaseId: purchase.id,
      cardId,
      tokenId,
      collect,
      binding,
      message: "Open the binding URL, complete Visa authentication, then call purchase_approved_product again.",
    };
  }

  if (!assuranceData) {
    const bindingSession = await waitForSession(binding.sessionId, waitMs);
    assuranceData = bindingSession.assuranceData;
    if (!assuranceData) {
      throw new Error("Visa authentication completed without assuranceData.");
    }
    purchase.assuranceData = assuranceData;
  }

  const intent = await createIntent(tokenId, assuranceData, product);
  const intentId = intent?.data?.id;
  if (!intentId) {
    throw new Error(`Intent creation returned no id: ${JSON.stringify(intent)}`);
  }

  const cryptogram = await getCryptogram(tokenId, intentId, product);
  const paymentCredential = cryptogram?.data?.attributes;
  if (!paymentCredential) {
    throw new Error(`Cryptogram response returned no payment credential: ${JSON.stringify(cryptogram)}`);
  }

  const result = {
    status: "completed",
    purchaseId: purchase.id,
    buyerId,
    product,
    cardId,
    tokenId,
    intentId,
    collect,
    binding,
    cryptogramId: cryptogram.data.id,
    paymentCredential,
  };
  purchase.status = "completed";
  purchase.result = result;
  return result;
}

async function getCardForBuyer(buyerId) {
  try {
    const response = await apiFetch(`/merchant/cards/${encodeURIComponent(buyerId)}`, { allow404: true });
    return response?.cardId ?? null;
  } catch (err) {
    // Server unreachable during approval flow — treat as no card on file.
    log(`getCardForBuyer fallback: ${err.message}`);
    return null;
  }
}

async function handleForgetCard(args) {
  const buyerId = args.buyerId || defaultBuyerId;
  const response = await apiFetch(`/merchant/cards/${encodeURIComponent(buyerId)}`, {
    method: "DELETE",
    allow404: true,
  });
  return {
    buyerId,
    forgotten: Boolean(response?.deleted),
  };
}

async function enrollAgenticToken(cardId, consumerEmail) {
  return apiFetch(`/cards/${encodeURIComponent(cardId)}/agentic-tokens`, {
    method: "POST",
    body: {
      data: {
        type: "agentic_tokens",
        attributes: { consumer_email: consumerEmail },
      },
    },
  });
}

async function createIntent(tokenId, assuranceData, product) {
  const effectiveUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return apiFetch(`/intents?tokenId=${encodeURIComponent(tokenId)}`, {
    method: "POST",
    body: {
      data: {
        type: "intents",
        attributes: {
          consumer_prompt: `Allow purchase of ${product.title} for ${formatMoney(product)} at ${product.merchantName}`,
          assurance_data: assuranceData,
          mandates: [{
            description: `One-time purchase: ${product.title}`,
            merchant_category: "Shoes",
            preferred_merchant_name: product.merchantName,
            merchant_category_code: product.mcc,
            decline_threshold: {
              amount: product.price,
              currency_code: product.currency,
            },
            effective_until: effectiveUntil,
            quantity: 1,
          }],
        },
      },
    },
  });
}

async function getCryptogram(tokenId, intentId, product) {
  return apiFetch(`/cryptograms?tokenId=${encodeURIComponent(tokenId)}&intentId=${encodeURIComponent(intentId)}`, {
    method: "POST",
    body: {
      data: {
        type: "cryptograms",
        attributes: {
          transaction_data: [{
            merchant_country_code: product.merchantCountry,
            transaction_amount: {
              transaction_amount: formatAmount(product.price),
              transaction_currency_code: product.currency,
            },
            merchant_url: product.merchantUrl,
            merchant_name: product.merchantName,
          }],
        },
      },
    },
  });
}

async function waitForSession(sessionId, timeoutMs) {
  const expiresAt = Date.now() + timeoutMs;
  while (Date.now() < expiresAt) {
    const session = await apiFetch(`/sessions/${encodeURIComponent(sessionId)}`, { allow404: true });
    if (session?.status === "completed") return session;
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for browser session ${sessionId}.`);
}

async function apiFetch(path, { method = "GET", body, allow404 = false } = {}) {
  const url = `${apiBaseUrl}${path}`;
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`${method} ${url} failed (${response.status}): ${text}`);
  }
  return data;
}

function openBrowser(url) {
  if (!openBrowserEnabled) return false;
  const platform = process.platform;
  let command;
  let args;
  if (platform === "darwin") {
    command = "open";
    args = browserApp ? ["-a", browserApp, url] : [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch (err) {
    log(`Could not open browser: ${err.message}`);
    return false;
  }
}

function defaultBrowserOverride() {
  if (process.platform !== "darwin") return "";
  return isDefaultBrowserFirefox() ? "Google Chrome" : "";
}

function isDefaultBrowserFirefox() {
  try {
    const result = spawnSync(
      "defaults",
      ["read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    if (result.status !== 0 || !result.stdout) return false;

    return result.stdout.split(/\n\s{4}\},/).some((handler) => {
      const isBrowserHandler =
        /LSHandlerContentType\s*=\s*"?com\.apple\.default-app\.web-browser"?;/.test(handler)
        || /LSHandlerURLScheme\s*=\s*"?https?"?;/.test(handler);
      const isFirefox =
        /LSHandlerRole(?:All|Viewer)\s*=\s*"[^"]*firefox[^"]*";/i.test(handler);
      return isBrowserHandler && isFirefox;
    });
  } catch {
    return false;
  }
}

function buildAppUrl(path, params) {
  const url = new URL(path, appBaseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function formatToolText(name, result) {
  if (name === "search_products") {
    if (result.products.length === 0) return "No matching products found.";
    return result.products.map((product) => `${product.id}: ${product.title} - ${formatMoney(product)} at ${product.merchantName}`).join("\n");
  }
  if (name === "propose_purchase") {
    const cardLine = result.existingCard ? "\nCard on file: yes. Ask the user whether to reuse it or enter a new card." : "";
    return `${result.approvalText}${cardLine}\n\n${result.nextStep}`;
  }
  if (name === "purchase_approved_product") {
    if (result.status !== "completed") {
      return `${result.status}: ${result.message ?? "Browser action required."}`;
    }
    return `Payment cryptogram created for ${result.product.title}. intentId=${result.intentId}, cryptogramId=${result.cryptogramId}`;
  }
  if (name === "forget_card") {
    return result.forgotten
      ? `Removed card mapping for ${result.buyerId}.`
      : `No card was stored for ${result.buyerId}.`;
  }
  return JSON.stringify(result);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  send({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(message) {
  process.stderr.write(`[agentic-tokens-mcp] ${message}\n`);
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function formatMoney(product) {
  return `${formatAmount(product.price)} ${product.currency}`;
}

function formatAmount(amount) {
  return Number(amount).toFixed(2);
}

function currencyNumericCode(currency) {
  return { USD: "840", EUR: "978", GBP: "826", JPY: "392", AUD: "036", CAD: "124" }[currency] ?? "840";
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
