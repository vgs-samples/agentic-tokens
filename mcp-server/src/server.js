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
import { renderMarketingSite } from "./agency.js";

const SERVER_INFO = { name: "vgs-marketing-agency", version: "0.3.0" };
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

  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "create_marketing_site",
    {
      title: "Create a marketing site",
      description: "Generate a marketing landing page for the user from a short brief. Returns a draft `siteId` and a `previewUrl`. The site exists but is NOT yet published. AFTER calling this, ALWAYS immediately call `deploy_site` with the returned siteId — that step will check if a hosting subscription is needed and surface payment_required if so.",
      inputSchema: {
        companyName: z.string().describe("The brand or company name to feature, e.g. 'Acme Coffee Co'."),
        brief: z.string().describe("One-sentence description of what the company does. Used as the hero tagline if `tagline` is omitted."),
        tagline: z.string().optional().describe("Optional explicit hero tagline. If omitted, the brief is used."),
        style: z.enum(["modern", "playful", "corporate", "bold"]).optional().describe("Visual style. Defaults to 'modern'."),
        features: z.array(z.object({
          icon: z.string().optional().describe("Single emoji."),
          title: z.string(),
          body: z.string(),
        })).optional().describe("Up to 3 feature cards. If omitted, generic ones are used."),
        ctaPrimary: z.string().optional().describe("Primary CTA button label."),
        ctaSecondary: z.string().optional().describe("Secondary CTA button label."),
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => wrapToolResult("create_marketing_site", () => handleCreateMarketingSite(args, ctx)),
  );

  server.registerTool(
    "deploy_site",
    {
      title: "Deploy a site to live URL",
      description: "Publish a draft site so it becomes reachable at its `previewUrl`. Hosting costs $5/month — if the buyer has no active subscription, this tool returns `status: payment_required` with a `paymentRequestId` and the agent should propose subscribing to the user. After the user agrees, call `authorize_subscription` with the paymentRequestId, then call `deploy_site` again.",
      inputSchema: {
        siteId: z.string().describe("Site id returned by create_marketing_site."),
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    (args) => wrapToolResult("deploy_site", () => handleDeploySite(args, ctx)),
  );

  server.registerTool(
    "authorize_subscription",
    {
      title: "Authorize hosting subscription",
      description: "Complete payment for a pending payment request. Reuses the buyer's most recent card on file (or opens a card collection page if none) and triggers Visa device authentication (TouchID / FIDO / OTP) in a browser tab. Once authentication completes, an intent is created with a recurring mandate and a cryptogram is fetched, activating the subscription. After this returns `status: completed`, call `deploy_site` again to publish the site.",
      inputSchema: {
        paymentRequestId: z.string().describe("Returned by deploy_site when payment_required."),
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

async function handleCreateMarketingSite(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const siteId = createId("site").replace("site_", "s").slice(0, 8);
  const html = renderMarketingSite({
    siteId,
    companyName: args.companyName,
    brief: args.brief,
    tagline: args.tagline,
    style: args.style,
    features: args.features,
    ctaPrimary: args.ctaPrimary,
    ctaSecondary: args.ctaSecondary,
  });

  await apiFetch(ctx, `/sites`, {
    method: "POST",
    body: { siteId, html, buyerId, companyName: args.companyName, brief: args.brief, status: "draft" },
  });

  return {
    siteId,
    buyerId,
    companyName: args.companyName,
    previewUrl: `${ctx.appBaseUrl}/s/${siteId}`,
    status: "draft",
    nextStep: `Site generated. Call deploy_site with siteId="${siteId}" to publish it. If the buyer has no active subscription, deploy_site will surface a payment request and you should ask the user to authorize a $5/month hosting subscription.`,
  };
}

async function handleDeploySite(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const siteId = args.siteId;
  const site = await apiFetch(ctx, `/sites/${encodeURIComponent(siteId)}`, { allow404: true });
  if (!site) throw new Error(`Unknown siteId: ${siteId}. Call create_marketing_site first.`);

  const subscription = await getActiveSubscription(ctx, buyerId);
  if (subscription) {
    await apiFetch(ctx, `/sites/${encodeURIComponent(siteId)}`, {
      method: "PUT",
      body: { status: "published", publishedAt: Date.now() },
    });
    return {
      status: "published",
      siteId,
      url: `${ctx.appBaseUrl}/s/${siteId}`,
      subscription: { plan: subscription.plan, expiresAt: subscription.expiresAt, active: true },
      nextStep: "Site is live at the returned url. You can open it to confirm.",
    };
  }

  const paymentRequestId = createId("pr").replace("pr_", "pr").slice(0, 10);
  await apiFetch(ctx, `/payment-requests`, {
    method: "POST",
    body: {
      id: paymentRequestId,
      buyerId,
      siteId,
      amount: SUBSCRIPTION_AMOUNT,
      currency: SUBSCRIPTION_CURRENCY,
      plan: SUBSCRIPTION_PLAN,
      reason: `Hosting subscription for site ${siteId} — $${SUBSCRIPTION_AMOUNT}/month`,
    },
  });

  return {
    status: "payment_required",
    siteId,
    paymentRequestId,
    amount: SUBSCRIPTION_AMOUNT,
    currency: SUBSCRIPTION_CURRENCY,
    plan: SUBSCRIPTION_PLAN,
    description: `Monthly hosting subscription with VGS Marketing Agency — $${SUBSCRIPTION_AMOUNT} / month`,
    nextStep: `Ask the user to authorize a $${SUBSCRIPTION_AMOUNT}/month hosting subscription. After they confirm, call authorize_subscription with paymentRequestId="${paymentRequestId}". After that returns status=completed, call deploy_site again.`,
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
    siteId: pr.siteId,
    subscription: subscriptionRecord.subscription,
    cardId,
    intentId,
    cryptogramId: cryptogram.data.id,
    paymentCredential,
    nextStep: pr.siteId
      ? `Subscription active. Call deploy_site with siteId="${pr.siteId}" to publish the site.`
      : "Subscription active.",
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
  if (name === "create_marketing_site") return formatCreateSite(result);
  if (name === "deploy_site") return formatDeploySite(result);
  if (name === "authorize_subscription") return formatAuthorizeSubscription(result);
  if (name === "list_subscriptions") return formatListSubscriptions(result);
  if (name === "cancel_subscription") return formatCancelSubscription(result);
  if (name === "list_buyer_cards") return formatBuyerCards(result);
  if (name === "forget_card") return formatForgetCard(result);
  return JSON.stringify(result);
}

function formatCreateSite(result) {
  return [
    `🎨 **Site generated** — \`${result.siteId}\``,
    "",
    "| | |",
    "|---|---|",
    `| Company | ${result.companyName} |`,
    `| Status | _draft (not yet published)_ |`,
    `| Preview | ${result.previewUrl} |`,
    "",
    `_${result.nextStep}_`,
  ].join("\n");
}

function formatDeploySite(result) {
  if (result.status === "published") {
    return [
      `🚀 **Site published**`,
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
      `💳 **Payment required**`,
      "",
      "| | |",
      "|---|---|",
      `| Site | \`${result.siteId}\` |`,
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
