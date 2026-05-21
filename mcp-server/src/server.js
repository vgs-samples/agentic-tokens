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
import { renderMarketingSite, THEME_COLORS } from "./agency.js";

const SERVER_INFO = { name: "vgs-marketing-agency", version: "0.5.2" };

// Zod schema for the JSON `params` the LLM produces. Matches the shape consumed by
// renderMarketingSite() in agency.js. Almost everything is optional — defaults in
// agency.js fill in any field the agent omits, so the LLM only sends what differs.
const siteParamsSchema = z.object({
  brand: z.object({
    emoji: z.string().describe("Single emoji for the brand logo, e.g. '🍓'."),
    name: z.string().describe("Brand name, e.g. 'СвежаяКлубника'."),
  }),
  themeColor: z.enum([...THEME_COLORS]).describe("Tailwind color family used throughout the page. Pick one that fits the brand theme."),
  language: z.enum(["ru", "en"]).optional().describe("Page language. Defaults to 'ru'."),
  hero: z.object({
    badge: z.string().describe("Small pill above the hero headline, e.g. '🌱 Сезон открыт · Сбор каждое утро'."),
    headlineLines: z.array(z.string()).length(3).describe("Hero h1 split into exactly 3 lines. The middle line is rendered in the theme accent color."),
    tagline: z.string().describe("One-paragraph hero tagline under the headline."),
    primaryCta: z.string().describe("Primary CTA button text, e.g. 'Заказать доставку'."),
    secondaryCta: z.string().describe("Secondary CTA button text, e.g. 'Посмотреть цены'."),
    usps: z.array(z.string()).length(3).describe("Three short USP markers shown below the CTAs, each prefixed with a green checkmark."),
  }),
  stats: z.array(z.object({
    value: z.string().describe("Stat value, e.g. '100%' or '3 ч'."),
    label: z.string().describe("Short label under the value."),
  })).length(4).describe("Four stat cards on the colored band under the hero."),
  about: z.object({
    eyebrow: z.string().describe("Tiny uppercase label above the section heading."),
    headlineLines: z.array(z.string()).length(2).describe("Section heading split into 2 lines."),
    paragraphs: z.array(z.string()).min(1).max(3).describe("1-3 paragraphs of body copy."),
    miniCards: z.array(z.object({
      icon: z.string().describe("Single emoji."),
      title: z.string(),
      subtitle: z.string(),
    })).length(2).describe("Two small accent cards next to the about copy."),
  }),
  why: z.object({
    eyebrow: z.string(),
    headline: z.string(),
    features: z.array(z.object({
      icon: z.string().describe("Single emoji."),
      title: z.string(),
      body: z.string(),
    })).length(6).describe("Exactly six feature cards in a 3-column grid."),
  }),
  prices: z.object({
    eyebrow: z.string(),
    headline: z.string(),
    subtitle: z.string(),
    popularBadge: z.string().describe("Badge text on the middle (highlighted) tier, e.g. 'ХИТ' or 'POPULAR'."),
    tiers: z.array(z.object({
      icon: z.string().describe("Emoji or short string."),
      name: z.string(),
      subtitle: z.string(),
      price: z.string().describe("Price string, e.g. '500₽' or '$29'."),
      unit: z.string().describe("Unit suffix, e.g. '/мес' or '/kg'."),
      bullets: z.array(z.string()).min(2).max(5),
      cta: z.string(),
    })).length(3).describe("Exactly three pricing tiers. The middle one renders highlighted with popularBadge."),
  }),
  reviews: z.object({
    eyebrow: z.string(),
    headline: z.string(),
    items: z.array(z.object({
      text: z.string(),
      initial: z.string().describe("Single character avatar."),
      name: z.string(),
      city: z.string(),
    })).length(3),
  }),
  order: z.object({
    eyebrow: z.string(),
    headlineLines: z.array(z.string()).length(2),
    subtitle: z.string(),
    quantities: z.array(z.string()).min(2).max(8).describe("Options for the 'what you need' select."),
    times: z.array(z.string()).length(3).describe("Three time-of-day options."),
    submitCta: z.string(),
  }).partial({ eyebrow: true, subtitle: true }).optional(),
  footer: z.object({
    tagline: z.string(),
    phone: z.string(),
    email: z.string(),
    location: z.string(),
    copyright: z.string().optional(),
  }).optional(),
  imageSeeds: z.object({
    hero: z.string().describe("Picsum seed for the hero image. Use a slug that fits the theme, e.g. 'berry-farm-2024'."),
    about: z.string().describe("Picsum seed for the about-section image."),
  }),
});

// Server-level instructions surfaced to the MCP client at initialize time.
// Clients (Claude Desktop, Cursor, etc.) include this in the model's context
// whenever any tool from this server is referenced, so this is the right
// place to mandate cross-tool workflow rules (artifact-first, payment auth)
// rather than repeating them inside every individual tool description.
const SERVER_INSTRUCTIONS = `You are using VGS Marketing Agency — a service that builds and hosts marketing landing pages.

The site itself is RENDERED ON THE SERVER from a fixed, polished template. You do NOT write HTML. You only generate a small JSON params object that fills the template — brand name, theme color, copy, prices, etc. The server handles all markup, Tailwind classes, animations, and image URLs.

When the user asks you to make / build / generate a marketing site, follow this exact workflow:

1. **Generate a JSON params object** that fits the user's brief. The schema is enforced by render_marketing_site / publish_site. Required top-level keys: brand, themeColor, hero, stats (x4), about, why (6 features), prices (3 tiers), reviews (3 items), imageSeeds. Tailor every text field to the user's theme — company name, tagline, USPs, feature titles, price tiers, fake testimonial text + cities, etc. Pick a themeColor that matches the brand (e.g. emerald for eco, rose for food, sky for tech, amber for warmth). Pick descriptive picsum imageSeeds (e.g. "berry-farm-2024", "mountain-coffee-roastery").

2. Call **render_marketing_site** with that params object. It returns \`siteId\`, \`previewUrl\`, and \`artifactHtml\` — the last one is a single-line <iframe> wrapper pointing at previewUrl.

3. **Use the artifacts capability** to create an artifact with type="text/html" whose body is the \`artifactHtml\` string from the tool result, verbatim (5 lines of HTML — keep it as-is). Claude Desktop will render the artifact in its side panel, which loads the full landing page via the embedded iframe.

   DO NOT paste raw HTML into the chat as a code block. DO NOT skip the artifact step — the previewUrl alone is a fallback, not the primary preview. Below the artifact, mention the previewUrl as a clickable fallback link, so the user can open the page in a separate browser tab if they want.

4. **Ask the user explicitly**: "Shall I publish this for $5/month?"
   Wait for their reply. Do not call publish_site without explicit user confirmation.

5. Once the user confirms, call **publish_site** with the SAME params object you passed to render_marketing_site.

6. If publish_site returns status="payment_required":
   - Surface the $5/month subscription to the user using the fields in the response
   - Wait for their explicit confirmation
   - Call **authorize_subscription** with the paymentRequestId
   - If it returns "waiting_for_authentication", surface the binding URL to the user, wait for them to complete TouchID / passkey, then call authorize_subscription again with the same paymentRequestId
   - Once authorize_subscription returns status="completed", call **publish_site AGAIN with the SAME params** — it will publish now

# Anti-patterns — do not do these:

- **Do NOT write raw HTML.** The server renders everything from params. If you find yourself writing <!doctype html> or any HTML tags (other than the artifactHtml iframe wrapper), stop and call render_marketing_site instead.
- **Do NOT write the params or HTML to a local file.** Pass params directly to the tool as JSON.
- **Do NOT skip step 3 (the artifact).** The artifact IS how the user previews the page. Without it they can't see what they're about to pay for.
- **Do NOT skip the confirmation steps.** Subscriptions are a real charge on a real card.
- **Do NOT call publish_site before render_marketing_site.** The user must preview before paying.`;
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
    "render_marketing_site",
    {
      title: "Render a marketing site preview",
      description: `Render a marketing landing page from a JSON \`params\` object. Stores the rendered HTML server-side as a preview (10-minute TTL) and returns \`{ siteId, previewUrl, artifactHtml }\`.

The agent should then create a Claude Desktop artifact (type="text/html") whose body is the tiny \`artifactHtml\` iframe wrapper — Claude Desktop's artifact panel renders the iframe, which loads the full page from \`previewUrl\`.

Use this BEFORE publish_site. The same params produce identical HTML, so previewing and publishing are deterministically the same page.

Do NOT write raw HTML yourself — generate only the params JSON.`,
      inputSchema: { params: siteParamsSchema },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => wrapToolResult("render_marketing_site", () => handleRenderMarketingSite(args, ctx)),
  );

  server.registerTool(
    "publish_site",
    {
      title: "Publish a marketing site",
      description: `Commit a marketing landing page to a permanent public URL (\`/s/<siteId>\`) hosted by VGS Marketing Agency. Costs $5/month.

Pass the SAME \`params\` you previously sent to render_marketing_site (the page the user previewed and approved). If the buyer has no active subscription, this returns status="payment_required" with a paymentRequestId — surface the subscription to the user, call authorize_subscription, then call publish_site AGAIN with the same params.`,
      inputSchema: {
        params: siteParamsSchema,
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
      description: "Complete payment for a pending payment request. Reuses the buyer's most recent card on file (or opens a card collection page if none) and triggers device authentication (TouchID / FIDO / OTP) in a browser tab. Once authentication completes, an intent is created with a recurring mandate and a cryptogram is fetched, activating the subscription. After this returns status='completed', call publish_site again with the SAME params you tried to publish before — now it will succeed.",
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

async function handleRenderMarketingSite(args, ctx) {
  const params = args.params;
  if (!params) throw new Error("params argument is required");

  const html = renderMarketingSite(params);
  const companyName = params.brand?.name ?? null;
  const siteId = createId("site").replace("site_", "s").slice(0, 8);

  // Store rendered HTML so /preview/<siteId> can serve it. Status="preview" means
  // /s/<siteId> still 404s — it only flips to "published" via publish_site.
  await apiFetch(ctx, `/sites`, {
    method: "POST",
    body: { siteId, html, buyerId: ctx.defaultBuyerId, companyName, status: "preview" },
  });

  const previewUrl = `${ctx.appBaseUrl}/preview/${siteId}`;
  // Small, self-contained artifact body — just an iframe pointing at /preview.
  // It's intentionally tiny: the LLM is reliably willing to write 5 lines of HTML
  // into an artifact (so Claude Desktop renders the artifact panel). Writing
  // a 5KB HTML document into an artifact, by contrast, often makes the model
  // fall back to dumping the HTML in chat as text.
  const artifactHtml = `<!doctype html><html><body style="margin:0;padding:0;height:100vh"><iframe src="${previewUrl}" style="width:100%;height:100%;border:0" loading="eager"></iframe></body></html>`;

  return {
    status: "preview",
    siteId,
    previewUrl,
    companyName,
    artifactHtml,
    nextStep: `Site rendered. Now in YOUR response do TWO things, exactly:
1) Write an artifact (Claude Desktop will render it in the side panel). The artifact body MUST be the artifactHtml string above (a 1-line iframe wrapper). Use the artifacts capability — do NOT just paste HTML in chat as a code block.
2) Below the artifact, write a short message to the user that includes the previewUrl as a fallback link, e.g. "Превью: ${previewUrl}". Then ask: "Опубликовать за $5/месяц?"
After the user confirms, call publish_site with the SAME params.`,
  };
}

async function handlePublishSite(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const params = args.params;
  if (!params) throw new Error("params argument is required");

  const html = renderMarketingSite(params);
  const companyName = params.brand?.name ?? null;

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

  // No active subscription — issue a payment request. The agent retains `params`
  // in conversation context and re-sends them after authorize_subscription completes.
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
    nextStep: `Ask the user to authorize a $${SUBSCRIPTION_AMOUNT}/month hosting subscription. After they confirm, call authorize_subscription with paymentRequestId="${paymentRequestId}". When that returns status=completed, call publish_site AGAIN with the SAME params — now it will publish.`,
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
    nextStep: "Subscription active. Call publish_site AGAIN with the SAME params you previously tried to publish — it will succeed now.",
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
  if (name === "render_marketing_site") return formatRenderSite(result);
  if (name === "publish_site") return formatPublishSite(result);
  if (name === "authorize_subscription") return formatAuthorizeSubscription(result);
  if (name === "list_subscriptions") return formatListSubscriptions(result);
  if (name === "cancel_subscription") return formatCancelSubscription(result);
  if (name === "list_buyer_cards") return formatBuyerCards(result);
  if (name === "forget_card") return formatForgetCard(result);
  return JSON.stringify(result);
}

function formatRenderSite(result) {
  return [
    `🎨 **Preview ready** for ${result.companyName ?? "your site"}`,
    "",
    `Preview URL: ${result.previewUrl}`,
    "",
    `_Now create an artifact (type: \`text/html\`) using the \`artifactHtml\` string from this response — it's a 1-line <iframe> wrapper, the LLM should write it itself. Claude Desktop will render the iframe in its artifact panel. Also share the previewUrl above as a clickable fallback. After the user reviews the page, ask "Shall I publish this for $5/month?" and call publish_site with the same params._`,
  ].join("\n");
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
