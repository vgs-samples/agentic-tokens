// Shared MCP server factory — VGS Marketing Agency.
//
// VGS Marketing Agency is a (fictional) startup that lets AI agents spin up,
// host, and bill for marketing landing pages on behalf of their user. This
// server exposes the agency's tool surface to any MCP client. The
// VGS Agentic Tokens stack underneath does the actual subscription payment
// (TouchID-bound intent + network cryptogram).
//
// Two transports wrap this factory:
//   - mcp-server/src/index.js     stdio (local install, auto-opens browser)
//   - netlify/functions/mcp.js    Web Standard HTTP (deployed, no browser open)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const SERVER_INFO = { name: "vgs-marketing-agency", version: "0.4.1" };

// Server-level instructions surfaced to the MCP client at initialize time.
// Clients (Claude Desktop, Cursor, etc.) include this in the model's context
// whenever any tool from this server is referenced, so this is the right
// place to mandate cross-tool workflow rules (artifact-first, payment auth)
// rather than repeating them inside every individual tool description.
const SERVER_INSTRUCTIONS = `You are using VGS Marketing Agency — a service that builds and hosts marketing landing pages.

When the user asks you to make / build / generate a marketing site (or anything similar), follow this exact workflow:

1. **Generate the full HTML yourself**, in your own response, as a complete document:
   - <!doctype html> through </html>
   - Tailwind via CDN: <script src="https://cdn.tailwindcss.com"></script>
   - Inter font from Google Fonts
   - Modern, semantic markup (header, hero, sections, footer)
   - Hero images from picsum.photos with a deterministic seed
   - No external JS that needs auth, no inline event handlers, no <script> beyond the Tailwind CDN
   - Tailor the content (company name, tagline, features, CTAs) to the user's brief

2. **Render the HTML as an Artifact with type "text/html"** so the user previews the page live in Claude Desktop's artifact panel BEFORE anything is published.

3. **Ask the user explicitly**: "Shall I publish this for $5/month?"
   Wait for their reply. Do not call publish_site without explicit user confirmation.

4. Once the user confirms, call **publish_site** with the same HTML string you put in the artifact.

5. If publish_site returns status="payment_required":
   - Surface the $5/month subscription to the user using the fields in the response
   - Wait for their explicit confirmation
   - Call **authorize_subscription** with the paymentRequestId
   - If it returns "waiting_for_authentication", surface the binding URL to the user, wait for them to complete it, then call authorize_subscription again with the same paymentRequestId
   - Once authorize_subscription returns status="completed", call **publish_site AGAIN with the SAME html** — it will publish now

Never skip step 2 (the artifact). The artifact IS the user's preview; without it, the user has no way to see what they're about to pay for.
Never skip step 3 or step 5's confirmation. Subscriptions are a real charge on a real card.`;
const DEFAULT_WAIT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_MS = 1500;
const SUBSCRIPTION_PLAN = "hosting-5usd-monthly";
const SUBSCRIPTION_AMOUNT = 5;
const SUBSCRIPTION_CURRENCY = "USD";
const SUBSCRIPTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function createMcpServer(options) {
  const {
    apiBaseUrl,
    appBaseUrl,
    requestStore,
    openBrowser = () => false,
    fetchImpl = fetch,
    buyerId: defaultBuyerId = "demo-buyer",
    consumerEmail: defaultConsumerEmail = "user@example.com",
    environment: defaultEnvironment = "sandbox",
    waitForBrowser: defaultWaitForBrowser = true,
    waitMs = DEFAULT_WAIT_MS,
    pollMs = DEFAULT_POLL_MS,
  } = options;

  if (!apiBaseUrl) throw new Error("createMcpServer: apiBaseUrl is required");
  if (!requestStore) throw new Error("createMcpServer: requestStore is required");
  const browserAppBaseUrl = appBaseUrl ?? deriveAppBaseUrl(apiBaseUrl);

  const ctx = {
    apiBaseUrl,
    appBaseUrl: browserAppBaseUrl,
    requestStore,
    openBrowser,
    fetchImpl,
    defaultBuyerId,
    defaultConsumerEmail,
    defaultEnvironment,
    defaultWaitForBrowser,
    waitMs,
    pollMs,
  };

  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });

  server.registerTool(
    "publish_site",
    {
      title: "Publish a marketing site",
      description: `Publish an HTML marketing site to a permanent public URL hosted by VGS Marketing Agency. Costs $5/month.

REQUIRED FLOW — follow exactly, in this order:

1. **Generate the full HTML yourself** as a complete document (<!doctype html> through </html>). Use:
   - Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
   - Inter from Google Fonts
   - Modern semantic markup (header, hero, sections, footer)
   - Hero images from picsum.photos with a deterministic seed, e.g. https://picsum.photos/seed/<slug>/1600/900
   - No external JS requiring auth, no inline event handlers
   - Tailor the content to the user's brief

2. **Render the HTML as an Artifact with type "text/html"** so the user can preview the site live in Claude Desktop's artifact panel BEFORE committing to publish.

3. **Ask the user explicitly**: "Shall I publish this for $5/month?" — wait for their answer.

4. ONLY after the user confirms, call publish_site with the same HTML you put in the artifact.

If the buyer has no active hosting subscription, this tool returns status="payment_required" with a paymentRequestId. In that case:
   - Surface the $5/month subscription to the user
   - Call authorize_subscription(paymentRequestId) — triggers the TouchID/passkey flow
   - After authorize_subscription returns status="completed", call publish_site AGAIN with the SAME html argument to actually publish

Returns the live URL on success.`,
      inputSchema: {
        html: z.string().describe("Full HTML document (must include <!doctype html>, <html>, <head>, <body>). This is the same HTML you put in the user-facing Artifact."),
        companyName: z.string().optional().describe("Company / brand name for storage metadata and display."),
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => wrapToolResult("publish_site", () => handlePublishSite(args, ctx)),
  );

  server.registerTool(
    "authorize_subscription",
    {
      title: "Authorize hosting subscription",
      description: "Complete payment for a pending payment request. Reuses the buyer's most recent card on file (or opens a card collection page if none) and triggers device authentication (TouchID / FIDO / OTP) in a browser tab. Once authentication completes, an intent is created with a recurring mandate and a cryptogram is fetched, activating the subscription. After this returns status='completed', call publish_site again with the SAME html you tried to publish before — now it will succeed.",
      inputSchema: {
        paymentRequestId: z.string().describe("Returned by publish_site when payment_required."),
        cardId: z.string().optional().describe("Explicit cardId to charge — pick from list_buyer_cards if there are multiple. Omit to default to the most recent saved card."),
        useExistingCard: z.boolean().optional().describe("Set false to force a fresh card collection even when cards exist on file. Defaults to true."),
        consumerEmail: z.string().optional().describe("Consumer email used for token enrollment and OTP."),
        waitForBrowser: z.boolean().optional().describe("If true (default in stdio mode), block until the browser steps finish. If false (default in HTTP mode), return waiting state immediately and resume by calling again with the same paymentRequestId."),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (args) => wrapToolResult("authorize_subscription", () => handleAuthorizeSubscription(args, ctx)),
  );

  server.registerTool(
    "list_subscriptions",
    {
      title: "List active subscriptions",
      description: "Show whether the buyer currently has an active hosting subscription with VGS Marketing Agency.",
      inputSchema: {
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => wrapToolResult("list_subscriptions", () => handleListSubscriptions(args, ctx)),
  );

  server.registerTool(
    "cancel_subscription",
    {
      title: "Cancel hosting subscription",
      description: "Cancel the buyer's active hosting subscription. Existing sites stop being published.",
      inputSchema: {
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => wrapToolResult("cancel_subscription", () => handleCancelSubscription(args, ctx)),
  );

  server.registerTool(
    "list_buyer_cards",
    {
      title: "List saved cards",
      description: "Return the cards a buyer has on file (last-4 + brand + opaque cardId). Use this when the user asks 'what cards do I have' or when picking which card to authorize a subscription with.",
      inputSchema: {
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => wrapToolResult("list_buyer_cards", () => handleListBuyerCards(args, ctx)),
  );

  server.registerTool(
    "forget_card",
    {
      title: "Forget saved card",
      description: "Remove a saved card from the buyer's file. Pass a specific cardId to forget one card, or omit cardId to clear every card for that buyer.",
      inputSchema: {
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
        cardId: z.string().optional().describe("Optional: forget only this card. Omit to clear all cards."),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => wrapToolResult("forget_card", () => handleForgetCard(args, ctx)),
  );

  return server;
}

// --- Tool handlers ---

async function handlePublishSite(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const html = args.html;
  const companyName = args.companyName ?? null;

  if (typeof html !== "string" || html.length < 50) {
    throw new Error("html argument is required and must be a full HTML document. Generate the HTML yourself, render it as an Artifact for the user to preview, and then pass the same HTML here.");
  }

  const subscription = await getActiveSubscription(ctx, buyerId);
  if (subscription) {
    const siteId = createId("site").replace("site_", "s").slice(0, 8);
    await apiFetch(ctx, `/sites`, {
      method: "POST",
      body: { siteId, html, buyerId, companyName, status: "published" },
    });
    return {
      status: "published",
      siteId,
      url: `${ctx.appBaseUrl}/s/${siteId}`,
      companyName,
      subscription: { plan: subscription.plan, expiresAt: subscription.expiresAt, active: true },
      nextStep: "Site is live at the returned url. Share it with the user.",
    };
  }

  // No active subscription — issue a payment request. We do NOT store the HTML
  // server-side at this stage; the agent retains it in conversation context
  // (inside the Artifact it created) and re-sends it after authorize_subscription
  // completes.
  const paymentRequestId = createId("pr").replace("pr_", "pr").slice(0, 10);
  await apiFetch(ctx, `/payment-requests`, {
    method: "POST",
    body: {
      id: paymentRequestId,
      buyerId,
      amount: SUBSCRIPTION_AMOUNT,
      currency: SUBSCRIPTION_CURRENCY,
      plan: SUBSCRIPTION_PLAN,
      reason: `Hosting subscription for ${companyName || "marketing site"} — $${SUBSCRIPTION_AMOUNT}/month`,
    },
  });

  return {
    status: "payment_required",
    paymentRequestId,
    amount: SUBSCRIPTION_AMOUNT,
    currency: SUBSCRIPTION_CURRENCY,
    plan: SUBSCRIPTION_PLAN,
    description: `Monthly hosting subscription with VGS Marketing Agency — $${SUBSCRIPTION_AMOUNT} / month`,
    nextStep: `Ask the user to authorize a $${SUBSCRIPTION_AMOUNT}/month hosting subscription. After they confirm, call authorize_subscription with paymentRequestId="${paymentRequestId}". When that returns status=completed, call publish_site AGAIN with the SAME html — now it will publish.`,
  };
}

async function handleAuthorizeSubscription(args, ctx) {
  const paymentRequestId = args.paymentRequestId;
  const pr = await apiFetch(ctx, `/payment-requests/${encodeURIComponent(paymentRequestId)}`, { allow404: true });
  if (!pr) throw new Error(`Unknown or expired paymentRequestId: ${paymentRequestId}.`);
  if (pr.status === "completed") {
    return { status: "completed", paymentRequestId, alreadyActive: true, subscription: pr.subscription };
  }

  const buyerId = pr.buyerId || ctx.defaultBuyerId;
  const consumerEmail = args.consumerEmail || ctx.defaultConsumerEmail;
  const waitForBrowser = args.waitForBrowser ?? ctx.defaultWaitForBrowser;

  // Local in-flight state — survives between non-blocking calls in stdio mode.
  // In HTTP mode this is held in Blobs by the wrapping function.
  const flow = (await ctx.requestStore.get(paymentRequestId)) ?? {
    paymentRequestId, buyerId, status: "running",
  };
  const previousStatus = flow.status;
  flow.status = "running";

  if (args.useExistingCard === false) flow.forceNewCard = true;

  let cardId = flow.cardId ?? args.cardId ?? null;
  if (!cardId && !flow.forceNewCard) {
    const cards = await getCardsForBuyer(ctx, buyerId);
    if (cards.length > 0) cardId = cards[0].cardId;
  }

  let collect = flow.collect ?? null;
  if (!cardId && previousStatus === "waiting_for_card" && collect) {
    const cardSession = waitForBrowser
      ? await waitForSession(ctx, collect.sessionId, ctx.waitMs)
      : await apiFetch(ctx, `/sessions/${encodeURIComponent(collect.sessionId)}`, { allow404: true });
    if (!cardSession) {
      flow.status = "waiting_for_card";
      await ctx.requestStore.set(paymentRequestId, flow);
      return waitingResponse("waiting_for_card", paymentRequestId, collect, null, "Open the collect URL and save a card.");
    }
    cardId = cardSession.cardId;
    if (!cardId) throw new Error("Card collection completed without cardId.");
    flow.cardId = cardId;
  }

  if (!cardId) {
    const sessionId = createId("collect");
    const collectUrl = buildAppUrl(ctx, "/collect.html", { sessionId, buyer_id: buyerId });
    const opened = ctx.openBrowser(collectUrl);
    collect = { sessionId, url: collectUrl, opened };
    flow.collect = collect;

    if (!waitForBrowser) {
      flow.status = "waiting_for_card";
      await ctx.requestStore.set(paymentRequestId, flow);
      return waitingResponse("waiting_for_card", paymentRequestId, collect, null,
        "Open the collect URL, save a card, then call authorize_subscription again.");
    }
    const cardSession = await waitForSession(ctx, sessionId, ctx.waitMs);
    cardId = cardSession.cardId;
    if (!cardId) throw new Error("Card collection completed without cardId.");
    flow.cardId = cardId;
  }

  let tokenId = flow.tokenId;
  if (!tokenId) {
    const token = await enrollAgenticToken(ctx, cardId, consumerEmail);
    tokenId = token?.data?.id;
    if (!tokenId) throw new Error(`Token enrollment returned no id: ${JSON.stringify(token)}`);
    flow.tokenId = tokenId;
  }

  let binding = flow.binding ?? null;
  let assuranceData = flow.assuranceData ?? null;
  if (!assuranceData && previousStatus === "waiting_for_authentication" && binding) {
    const bindingSession = waitForBrowser
      ? await waitForSession(ctx, binding.sessionId, ctx.waitMs)
      : await apiFetch(ctx, `/sessions/${encodeURIComponent(binding.sessionId)}`, { allow404: true });
    if (!bindingSession) {
      flow.status = "waiting_for_authentication";
      await ctx.requestStore.set(paymentRequestId, flow);
      return waitingResponse("waiting_for_authentication", paymentRequestId, collect, binding,
        "Open the binding URL and complete TouchID / passkey authentication.");
    }
    assuranceData = bindingSession.assuranceData;
    if (!assuranceData) throw new Error("Device authentication completed without assuranceData.");
    flow.assuranceData = assuranceData;
  }

  if (!assuranceData) {
    const bindingSessionId = createId("binding");
    const bindingUrl = buildAppUrl(ctx, "/binding.html", {
      sessionId: bindingSessionId,
      buyer_id: buyerId,
      tokenId,
      product_name: `${SUBSCRIPTION_PLAN}`,
      merchant_name: "VGS Marketing Agency",
      amount: formatAmount(pr.amount),
      currency: pr.currency,
      currency_code: currencyNumericCode(pr.currency),
      consumer_email: consumerEmail,
      environment: ctx.defaultEnvironment,
    });
    binding = { sessionId: bindingSessionId, url: bindingUrl, opened: ctx.openBrowser(bindingUrl) };
    flow.binding = binding;
  }

  if (!assuranceData && !waitForBrowser) {
    flow.status = "waiting_for_authentication";
    flow.cardId = cardId;
    flow.tokenId = tokenId;
    await ctx.requestStore.set(paymentRequestId, flow);
    return waitingResponse("waiting_for_authentication", paymentRequestId, collect, binding,
      "Open the binding URL, complete TouchID / passkey authentication, then call authorize_subscription again.");
  }

  if (!assuranceData) {
    const bindingSession = await waitForSession(ctx, binding.sessionId, ctx.waitMs);
    assuranceData = bindingSession.assuranceData;
    if (!assuranceData) throw new Error("Device authentication completed without assuranceData.");
    flow.assuranceData = assuranceData;
  }

  const intent = await createSubscriptionIntent(ctx, tokenId, assuranceData, pr);
  const intentId = intent?.data?.id;
  if (!intentId) throw new Error(`Intent creation returned no id: ${JSON.stringify(intent)}`);

  const cryptogram = await getCryptogram(ctx, tokenId, intentId, pr);
  const paymentCredential = cryptogram?.data?.attributes;
  if (!paymentCredential) throw new Error(`Cryptogram response returned no payment credential: ${JSON.stringify(cryptogram)}`);

  const expiresAt = Date.now() + SUBSCRIPTION_DURATION_MS;
  const subscriptionRecord = await apiFetch(ctx, `/subscriptions/${encodeURIComponent(buyerId)}`, {
    method: "POST",
    body: {
      plan: pr.plan, amount: pr.amount, currency: pr.currency,
      cardId, tokenId, intentId, cryptogramId: cryptogram.data.id,
      expiresAt,
    },
  });

  await apiFetch(ctx, `/payment-requests/${encodeURIComponent(paymentRequestId)}`, {
    method: "PUT",
    body: {
      status: "completed",
      completedAt: Date.now(),
      subscription: subscriptionRecord.subscription,
    },
  });

  await ctx.requestStore.delete(paymentRequestId);

  return {
    status: "completed",
    paymentRequestId,
    subscription: subscriptionRecord.subscription,
    cardId,
    intentId,
    cryptogramId: cryptogram.data.id,
    paymentCredential,
    nextStep: "Subscription active. Call publish_site AGAIN with the SAME html you previously tried to publish — it will succeed now.",
  };
}

async function handleListSubscriptions(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const response = await apiFetch(ctx, `/subscriptions/${encodeURIComponent(buyerId)}`, { allow404: true });
  return { buyerId, subscription: response?.subscription ?? null };
}

async function handleCancelSubscription(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const response = await apiFetch(ctx, `/subscriptions/${encodeURIComponent(buyerId)}`, { method: "DELETE", allow404: true });
  return { buyerId, canceled: Boolean(response?.deleted) };
}

async function handleListBuyerCards(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const cards = await getCardsForBuyer(ctx, buyerId);
  return { buyerId, cards: cards.map((c) => ({ ...c, label: formatCardLabel(c) })) };
}

async function handleForgetCard(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const path = args.cardId
    ? `/merchant/cards/${encodeURIComponent(buyerId)}?cardId=${encodeURIComponent(args.cardId)}`
    : `/merchant/cards/${encodeURIComponent(buyerId)}`;
  const response = await apiFetch(ctx, path, { method: "DELETE", allow404: true });
  return { buyerId, cardId: args.cardId ?? null, forgotten: Boolean(response?.deleted) };
}

// --- Helpers shared by tools ---

async function getActiveSubscription(ctx, buyerId) {
  const response = await apiFetch(ctx, `/subscriptions/${encodeURIComponent(buyerId)}`, { allow404: true });
  const sub = response?.subscription;
  if (!sub) return null;
  if (sub.active !== true) return null;
  return sub;
}

async function getCardsForBuyer(ctx, buyerId) {
  try {
    const response = await apiFetch(ctx, `/merchant/cards/${encodeURIComponent(buyerId)}`, { allow404: true });
    return Array.isArray(response?.cards) ? response.cards : [];
  } catch (err) {
    log(`getCardsForBuyer fallback: ${err.message}`);
    return [];
  }
}

async function enrollAgenticToken(ctx, cardId, consumerEmail) {
  return apiFetch(ctx, `/cards/${encodeURIComponent(cardId)}/agentic-tokens`, {
    method: "POST",
    body: { data: { type: "agentic_tokens", attributes: { consumer_email: consumerEmail } } },
  });
}

async function createSubscriptionIntent(ctx, tokenId, assuranceData, paymentRequest) {
  const effectiveUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return apiFetch(ctx, `/intents?tokenId=${encodeURIComponent(tokenId)}`, {
    method: "POST",
    body: {
      data: {
        type: "intents",
        attributes: {
          consumer_prompt: `Authorize VGS Marketing Agency hosting subscription — $${paymentRequest.amount}/month, recurring monthly`,
          assurance_data: assuranceData,
          mandates: [{
            description: `Monthly hosting — VGS Marketing Agency`,
            merchant_category: "Web hosting",
            preferred_merchant_name: "VGS Marketing Agency",
            merchant_category_code: "4816",
            decline_threshold: {
              amount: paymentRequest.amount,
              currency_code: paymentRequest.currency,
            },
            effective_until: effectiveUntil,
            quantity: 12,
          }],
        },
      },
    },
  });
}

async function getCryptogram(ctx, tokenId, intentId, paymentRequest) {
  return apiFetch(ctx, `/cryptograms?tokenId=${encodeURIComponent(tokenId)}&intentId=${encodeURIComponent(intentId)}`, {
    method: "POST",
    body: {
      data: {
        type: "cryptograms",
        attributes: {
          transaction_data: [{
            merchant_country_code: "US",
            transaction_amount: {
              transaction_amount: formatAmount(paymentRequest.amount),
              transaction_currency_code: paymentRequest.currency,
            },
            merchant_url: "https://vgs-marketing-agency.example",
            merchant_name: "VGS Marketing Agency",
          }],
        },
      },
    },
  });
}

async function waitForSession(ctx, sessionId, timeoutMs) {
  const expiresAt = Date.now() + timeoutMs;
  while (Date.now() < expiresAt) {
    const session = await apiFetch(ctx, `/sessions/${encodeURIComponent(sessionId)}`, { allow404: true });
    if (session?.status === "completed") return session;
    await sleep(ctx.pollMs);
  }
  throw new Error(`Timed out waiting for browser session ${sessionId}.`);
}

async function apiFetch(ctx, path, { method = "GET", body, allow404 = false } = {}) {
  const url = `${ctx.apiBaseUrl}${path}`;
  const response = await ctx.fetchImpl(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`${method} ${url} failed (${response.status}): ${text}`);
  return data;
}

function buildAppUrl(ctx, path, params) {
  const url = new URL(path, ctx.appBaseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function deriveAppBaseUrl(apiBaseUrl) {
  return apiBaseUrl.replace(/\/api\/?$/, "") || apiBaseUrl;
}

function waitingResponse(status, paymentRequestId, collect, binding, message) {
  return { status, paymentRequestId, collect, binding, message };
}

// --- Result formatting ---

async function wrapToolResult(name, fn) {
  try {
    const structuredContent = await fn();
    return {
      content: [{ type: "text", text: formatToolText(name, structuredContent) }],
      structuredContent,
      isError: false,
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `❌ **${name}** failed\n\n${err.message}` }],
      structuredContent: { error: err.message },
      isError: true,
    };
  }
}

function formatToolText(name, result) {
  if (name === "publish_site") return formatPublishSite(result);
  if (name === "authorize_subscription") return formatAuthorizeSubscription(result);
  if (name === "list_subscriptions") return formatListSubscriptions(result);
  if (name === "cancel_subscription") return formatCancelSubscription(result);
  if (name === "list_buyer_cards") return formatBuyerCards(result);
  if (name === "forget_card") return formatForgetCard(result);
  return JSON.stringify(result);
}

function formatPublishSite(result) {
  if (result.status === "published") {
    // Live full-page screenshot of the just-published site.
    const screenshot = `https://api.microlink.io/?url=${encodeURIComponent(result.url)}&screenshot=true&meta=false&embed=screenshot.url&viewport.width=1280&viewport.height=800`;
    return [
      `🚀 **Site published**`,
      "",
      `![Live site](${screenshot})`,
      "",
      "| | |",
      "|---|---|",
      `| Site | \`${result.siteId}\` |`,
      `| Live URL | **${result.url}** |`,
      `| Subscription | _active until ${new Date(result.subscription.expiresAt).toISOString().slice(0, 10)}_ |`,
      "",
      `_${result.nextStep}_`,
    ].join("\n");
  }
  if (result.status === "payment_required") {
    return [
      `💳 **Hosting subscription required**`,
      "",
      "| | |",
      "|---|---|",
      `| Plan | ${result.plan} |`,
      `| Amount | **$${result.amount} / month** |`,
      `| Payment request | \`${result.paymentRequestId}\` |`,
      "",
      `_${result.nextStep}_`,
    ].join("\n");
  }
  return JSON.stringify(result);
}

function formatAuthorizeSubscription(result) {
  if (result.status === "completed") {
    return [
      `✅ **Subscription active**`,
      "",
      "| | |",
      "|---|---|",
      `| Plan | ${result.subscription.plan} |`,
      `| Card | \`${result.cardId}\` |`,
      `| Intent | \`${result.intentId}\` |`,
      `| Cryptogram | \`${result.cryptogramId}\` |`,
      `| Active until | ${new Date(result.subscription.expiresAt).toISOString().slice(0, 10)} |`,
      "",
      `_${result.nextStep}_`,
    ].join("\n");
  }
  if (result.status === "waiting_for_card" || result.status === "waiting_for_authentication") {
    const url = result.collect?.url || result.binding?.url;
    const action = result.status === "waiting_for_card"
      ? "Open the card form in your browser:"
      : "Complete device authentication (TouchID / passkey) in your browser:";
    const niceStatus = result.status.replace(/_/g, " ");
    const msg = result.message ? `\n\n${result.message}` : "";
    return `⏳ **${niceStatus}**\n\n${action}\n${url}${msg}`;
  }
  return JSON.stringify(result);
}

function formatListSubscriptions(result) {
  if (!result.subscription) return `💳 No active subscription for \`${result.buyerId}\`.`;
  const sub = result.subscription;
  return [
    `💳 **Subscription for \`${result.buyerId}\`**`,
    "",
    "| | |",
    "|---|---|",
    `| Plan | ${sub.plan} |`,
    `| Amount | $${sub.amount} ${sub.currency} / month |`,
    `| Status | ${sub.active ? "active" : "expired/canceled"} |`,
    `| Expires | ${sub.expiresAt ? new Date(sub.expiresAt).toISOString().slice(0, 10) : "—"} |`,
  ].join("\n");
}

function formatCancelSubscription(result) {
  return result.canceled
    ? `🗑️ Subscription canceled for \`${result.buyerId}\`.`
    : `ℹ️ No active subscription for \`${result.buyerId}\`.`;
}

function formatBuyerCards(result) {
  if (result.cards.length === 0) return `💳 No cards on file for \`${result.buyerId}\`.`;
  const header = "| # | Card | ID |\n|---|---|---|";
  const rows = result.cards.map((c, i) => `| **${i + 1}** | ${c.label} | \`${c.cardId}\` |`).join("\n");
  return `💳 **Cards on file for \`${result.buyerId}\`**\n\n${header}\n${rows}`;
}

function formatForgetCard(result) {
  if (!result.forgotten) {
    return result.cardId
      ? `ℹ️ No card \`${result.cardId}\` was stored for \`${result.buyerId}\`.`
      : `ℹ️ No cards were stored for \`${result.buyerId}\`.`;
  }
  return result.cardId
    ? `🗑️ Removed card \`${result.cardId}\` for \`${result.buyerId}\`.`
    : `🗑️ Cleared all cards for \`${result.buyerId}\`.`;
}

function formatCardLabel(card) {
  const brand = `[${normalizeBrand(card.brand)}]`;
  const number = card.lastFour ? `****${card.lastFour}` : `…${card.cardId.slice(-4)}`;
  const exp = card.expMonth && card.expYear
    ? ` ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`
    : "";
  return `${brand} ${number}${exp}`;
}

function normalizeBrand(brand) {
  if (!brand) return "CARD";
  return String(brand).toUpperCase().replace(/[\s_]+/g, "-");
}

// --- Utils ---

function log(message) {
  process.stderr.write(`[vgs-marketing-agency] ${message}\n`);
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

// --- Built-in request store ---

export class InMemoryRequestStore {
  #map = new Map();
  async get(id) { return this.#map.get(id) ?? null; }
  async set(id, value) { this.#map.set(id, value); }
  async delete(id) { this.#map.delete(id); }
}

// Backwards-compat alias (older code referred to this as InMemoryPurchaseStore).
export const InMemoryPurchaseStore = InMemoryRequestStore;
