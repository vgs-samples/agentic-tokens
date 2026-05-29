// Shared MCP server factory — Vellum.
//
// Vellum is a (fictional) startup that lets AI agents spin up,
// host, and bill for marketing landing pages on behalf of their user. This
// server exposes the agency's tool surface to any MCP client. The
// VGS Agentic Tokens stack underneath does the actual payment ($5 per
// published site, TouchID-bound intent + per-charge cryptogram).
//
// Two transports wrap this factory:
//   - mcp-server/src/index.js     stdio (local install, auto-opens browser)
//   - netlify/functions/mcp.js    Web Standard HTTP (deployed, no browser open)

import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderMarketingSite, THEME_COLORS } from "./agency.js";

const SERVER_INFO = { name: "vellum", version: "0.6.0" };

// Zod schema for the JSON `params` the LLM produces. Matches the shape consumed by
// renderMarketingSite() in agency.js. Almost everything is optional — defaults in
// agency.js fill in any field the agent omits, so the LLM only sends what differs.
const siteParamsSchema = z.object({
  brand: z.object({
    emoji: z.string().describe("Single emoji for the brand logo, e.g. '🍓'."),
    name: z.string().describe("Brand name, e.g. 'FreshBerry'."),
  }),
  themeColor: z.enum([...THEME_COLORS]).describe("Tailwind color family used throughout the page. Pick one that fits the brand theme."),
  language: z.enum(["en", "ru"]).optional().describe("Page language. Defaults to 'en'."),
  hero: z.object({
    badge: z.string().describe("Small pill above the hero headline, e.g. '🌱 Fresh harvest · Picked every morning'."),
    headlineLines: z.array(z.string()).length(3).describe("Hero h1 split into exactly 3 lines. The middle line is rendered in the theme accent color."),
    tagline: z.string().describe("One-paragraph hero tagline under the headline."),
    primaryCta: z.string().describe("Primary CTA button text, e.g. 'Order delivery'."),
    secondaryCta: z.string().describe("Secondary CTA button text, e.g. 'View pricing'."),
    usps: z.array(z.string()).length(3).describe("Three short USP markers shown below the CTAs, each prefixed with a green checkmark."),
  }),
  stats: z.array(z.object({
    value: z.string().describe("Stat value, e.g. '100%' or '3 hrs'."),
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
    popularBadge: z.string().describe("Badge text on the middle (highlighted) tier, e.g. 'POPULAR'."),
    tiers: z.array(z.object({
      icon: z.string().describe("Emoji or short string."),
      name: z.string(),
      subtitle: z.string(),
      price: z.string().describe("Price string, e.g. '$19' or '$29'."),
      unit: z.string().describe("Unit suffix, e.g. '/mo' or '/kg'."),
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

const DEFAULT_WAIT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_MS = 1500;
const PAYMENT_PLAN = "hosting-single-charge";
const PAYMENT_AMOUNT = 5;
const PAYMENT_CURRENCY = "USD";
// Every publish intentionally creates a fresh TouchID-bound intent. The high
// quantity is still sent in the VGS mandate so authorization_status can describe
// the full envelope for demo narration.
const MANDATE_QUANTITY = 1000;
const INTENT_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

// VGS is async on /cryptograms — first POST returns a "pending" shape
// (data.attributes.intent_id + status, no cryptogram object) and the real
// cryptogram becomes available a few seconds later. Instead of blocking inside
// one tool call (would exceed Netlify's 10–26s function timeout), we return a
// "waiting_for_cryptogram" status and have the agent poll by calling
// authorize_payment again — same pattern as waiting_for_card / waiting_for_authentication.
const CRYPTOGRAM_POLL_SECONDS = 5;
const MAX_CRYPTOGRAM_ATTEMPTS = 6;
const BROWSER_HANDOFF_POLL_SECONDS = 3;
const PAYMENT_REQUEST_READ_RETRIES = 6;
const PAYMENT_REQUEST_READ_DELAY_MS = 500;
const TRANSIENT_AUTHORIZE_RETRY_SECONDS = 3;

// Server-level instructions surfaced to the MCP client at initialize time.
// Clients (Claude Desktop, Cursor, etc.) include this in the model's context
// whenever any tool from this server is referenced, so this is the right
// place to mandate cross-tool workflow rules (preview-first, payment auth)
// rather than repeating them inside every individual tool description.
const SERVER_INSTRUCTIONS = `You are using Vellum — a service that builds and hosts marketing landing pages.

The site itself is RENDERED ON THE SERVER from a fixed, polished template. You do NOT write HTML. You only generate a small JSON params object that fills the template — brand name, theme color, copy, prices, etc. The server handles all markup, Tailwind classes, animations, and image URLs.

If the user asks "how much are you authorized to spend", "what did I authorize", or asks about the intent limits, call \`authorization_status\` and answer from the returned intent and mandate fields. If the user asks to "show the cryptogram", "show payment proof", or asks about the last one-time credential, call \`payment_proof\`. Do not answer these from memory.

## CRITICAL: one tool call per turn

Every Vellum tool call **must be its own assistant turn**. NEVER batch two Vellum tool calls in the same assistant response.

Specifically: \`authorize_payment\` and \`publish_site\` (post-payment) are sequential — the second one depends on the first being fully completed. If you emit both in the same turn, your client will run them in parallel, \`publish_site\` will see a not-yet-completed payment_request, throw an error, and the whole flow will retry messily. The result is 2–3× duplicate tool calls in the user's view, which is ugly and wastes a real $5 charge.

The rule:
1. Emit ONE tool call.
2. Wait for the tool result to come back.
3. Read the result.
4. Then emit the next tool call (in a new turn).

This applies to every transition: create_marketing_site/render_marketing_site → publish_site(1) → authorize_payment → publish_site(2).

## Workflow

When the user asks you to make / build / generate a marketing site, follow this exact workflow:

1. **Generate a JSON params object** that fits the user's brief. The schema is enforced by render_marketing_site / publish_site. Required top-level keys: brand, themeColor, hero, stats (x4), about, why (6 features), prices (3 tiers), reviews (3 items), imageSeeds. Tailor every text field to the user's theme — company name, tagline, USPs, feature titles, price tiers, fake testimonial text + cities, etc. Pick a themeColor that matches the brand (e.g. emerald for eco, rose for food, sky for tech, amber for warmth). Pick descriptive picsum imageSeeds (e.g. "berry-farm-2024", "mountain-coffee-roastery").

2. **Before calling the tool, write exactly ONE short prose sentence** describing the design in human terms. Example: "Drafting a landing page for **Acme Coffee Co** — premium beans, emerald theme." That single sentence is the ONLY thing the user should see about the params. Do not paste, summarize, enumerate, or otherwise echo the JSON in chat — the preview is the canonical view, and the user does not want to read 200 lines of JSON. Then call **create_marketing_site** with the params object. \`render_marketing_site\` is kept as a backward-compatible alias for the same preview step. Both return \`siteId\` and \`previewUrl\`; HTTP-style previews also return \`artifactHtml\`, while local previews return \`previewPath\`.

3. **Show the preview to the user using whichever inline mechanism your client supports**, in this priority order:
   a. **Codex CLI / terminal client**: paste the returned \`previewUrl\` or \`previewPath\`. If the tool result has \`opened=true\`, say the preview opened; otherwise ask the user to open it manually.
   b. **You have a Write / file-creation tool with a preview pane (Claude Code, Cursor, similar IDE-style agents)**: write \`artifactHtml\` to a file (e.g. \`/tmp/preview-<siteId>.html\` or \`./preview.html\`) when \`artifactHtml\` is present. Your client's preview pane will render it automatically.
   c. **You have an artifacts capability (Claude Desktop, Claude.ai web)**: create an artifact with type="text/html" whose body is \`artifactHtml\`. Claude opens it in the side panel.
   d. **Neither is available**: paste \`previewUrl\` as a clickable link.

   "Create an artifact" is a generic instruction — translate it to your client's actual capability (Write+preview, antartifact tag, etc.). DO NOT paste raw HTML into chat as a code block.

4. **Ask the user explicitly**: "Shall I publish this for $5?" — every published site is a one-time $5 charge. There is no subscription. The buyer's card is remembered for future publishes, but the charge runs every time.
   Wait for their reply. Do not call publish_site without explicit user confirmation.

5. Once the user confirms, call **publish_site** with the SAME params and NO \`paymentRequestId\` (the first call kicks off a fresh payment).

6. publish_site returns status="payment_required" with a fresh \`paymentRequestId\`. It also includes \`savedCards\`, \`walletReady\` (always false for publish), and \`intentExpiresAt\` (null for publish). Branch:
   - **\`savedCards\` has one or more cards**: show the complete payment-method list from the tool result, including the "Add a new card" option, and ask the user which payment method to use. Do NOT silently pick the first card and do NOT call authorize_payment until the user chooses. If the user picks a saved card, call **authorize_payment** with \`paymentRequestId\` and that exact \`cardId\`; the server will still require TouchID and create a fresh intent for this payment. If the user picks "Add a new card", call **authorize_payment** with \`paymentRequestId\` and \`useExistingCard:false\`.
   - **\`savedCards\` is empty**: no card is on file. Do NOT ask for payment confirmation again — the user already approved the $5 charge in step 4. Print "No card on file — opening card form." and IMMEDIATELY call **authorize_payment** with \`useExistingCard:false\`. It will return status="waiting_for_card" with a URL; surface that URL to the user, then poll by calling authorize_payment again with the same paymentRequestId until the browser posts completion.
   - If authorize_payment returns "pending", this is a recoverable infrastructure/network interruption, NOT a declined or failed payment. Print a short "still pending, retrying" line, wait for retryAfterSeconds, then call authorize_payment AGAIN with the same paymentRequestId.
   - If authorize_payment returns "waiting_for_card" or "waiting_for_authentication", surface the URL to the user, wait a few seconds, then call authorize_payment AGAIN with the same paymentRequestId. The browser page posts completion to /api/sessions/:id; the repeated authorize_payment call reads it automatically. Do NOT ask the user to say "done" before polling.
   - If authorize_payment returns "waiting_for_cryptogram", the VGS cryptogram is still being generated (this typically takes 5–15 seconds after intent creation). Print "⏳ Generating payment cryptogram…", wait ~5 seconds, then call authorize_payment AGAIN with the same paymentRequestId — no other arguments. Repeat until status="completed". Do NOT call publish_site or any other tool while polling.
   - When authorize_payment returns status="completed", **first print the explicit success line from \`nextStep\`** to the user as its own short message. The format is fixed:

     > ✅ Payment successful — $5 USD charged on card ending <last4> (cryptogram \`<id>\`, ... intent valid until <date>).

     This is the moment where the user must see that money moved. Do NOT skip it. Do NOT merge it into the later "Published" message. Do NOT batch it with publish_site in the same turn — print the success line, end the turn, then in the next turn call publish_site.
   - The tool result table also includes \`cryptogramId\`, masked \`paymentCredential\` (dpanMasked, expiry, cryptogramPreview), and \`intentExpiresAt\`. DO NOT reformat, hide, or summarize that table — the user wants to see a brand-new one-time cryptogram for every $5 charge.
   - Finally, call **publish_site AGAIN** with the SAME params AND \`paymentRequestId\` (the one you just authorized). The server validates the charge, publishes the site, and marks that paymentRequestId as redeemed (it cannot be reused).

7. **Final user-facing message after publish_site returns status=published — keep it SHORT and in English.** The final message announces the URL and includes the payment proof block from the tool result:

   > ✅ Deploy complete — <URL>
   >
   > Payment proof for <paymentRequestId>:
   >
   > <cryptogram id>
   >
   > Details:
   >
   > - Type: DAVV
   > - DPAN: ••••-••••-••••-7631
   > - DPAN expiry: 04/28
   > - Expires: 2026-06-01T21:38:33+00:00
   > - Confirmation status: APPROVED

   That's the whole message. Do NOT repeat the amount or card id — they were already shown in the previous turn's payment-success line.

# Anti-patterns — do not do these:

- **Do NOT write raw HTML.** The server renders everything from params. If you find yourself writing <!doctype html> or any HTML tags (other than the artifactHtml iframe wrapper), stop and call create_marketing_site instead.
- **Do NOT echo the params JSON in chat** — not before the tool call, not after, not as a code block, not as a bullet list, not as a "here's what I'm building" summary of every field. One short prose sentence (step 2) is the whole user-visible description. The tool's arguments panel and preview cover the rest.
- **Do NOT write the params or HTML to a local file** (other than the artifactHtml iframe wrapper from step 3a). Pass params directly to the tool as JSON.
- **Do NOT skip step 3 (the preview).** The preview is how the user reviews the page. Without it they can't see what they're about to pay for.
- **Do NOT skip the Payment-successful line** at the end of step 6. That single message is the demo's proof — it shows amount, card last4, and cryptogram id. The whole point is making the per-charge cryptogram visible.
- **Do NOT repeat amount or card details in the step-7 publish message.** Once Payment-successful was shown, the final deploy message should include only the URL and the payment proof block. Keep this block in English.
- **Do NOT batch Vellum tool calls in the same assistant turn.** Especially never \`authorize_payment\` + \`publish_site\` together. They depend on each other; running in parallel triggers retries and double-charges in the trace. One call per turn. Period. (See the "one tool call per turn" rule at the top of these instructions.)
- **Do NOT pass paymentRequestId on the FIRST publish_site call** of a new site. That parameter is only for the second (post-payment) call. Passing it on the first call will fail.
- **Do NOT reuse a paymentRequestId across sites.** Each site costs $5 and needs its own paymentRequestId. Reusing one fails with "already redeemed".
- **Do NOT call publish_site before create_marketing_site/render_marketing_site.** The user must preview before paying.
- **Do NOT mention "subscription" or "monthly".** This model is one-time-per-site. The saved wallet is only proof/history of the latest authorization; every publish still requires TouchID and a fresh intent.`;

function buildServerInstructions(clientMode) {
  if (clientMode !== "codex-cli") return SERVER_INSTRUCTIONS;

  return `${SERVER_INSTRUCTIONS}

## Codex CLI mode

This server is running for Codex CLI. Assume there is no in-app browser and no artifact panel. The local MCP server may auto-open the system browser for previews, card collection, and TouchID/passkey authentication, but the assistant must still surface the URL.

- After create_marketing_site/render_marketing_site returns, surface the returned previewUrl or previewPath directly to the user. If previewPath is present, it is already a local HTML preview written by the server.
- Do not claim that a browser was opened unless the tool result says opened=true.
- For waiting_for_card and waiting_for_authentication, paste the returned URL. If the tool result says opened=true, tell the user the browser was opened and ask them to complete the browser step there. If opened=false, ask them to open the URL manually. Then poll automatically by calling authorize_payment again with the same paymentRequestId after the tool result's retryAfterSeconds. Do NOT ask the user to say "done"; the browser posts completion to /api/sessions/:id and authorize_payment reads it on the next poll.
- For add_buyer_card, paste the returned collect URL and poll by calling add_buyer_card again with the same cardRequestId after retryAfterSeconds. This card-only flow does not create a payment request, TouchID intent, cryptogram, or charge.
- Never pass waitForBrowser=true in Codex CLI. Let authorize_payment return waiting_for_card / waiting_for_authentication immediately, then keep polling authorize_payment until the browser step completion appears.
- Do not block waiting for browser completion in Codex CLI. The server defaults to non-blocking URL handoff in this mode.`;
}

export function createMcpServer(options) {
  const {
    apiBaseUrl,
    appBaseUrl,
    requestStore,
    openBrowser = () => false,
    openPreview = openBrowser,
    fetchImpl = fetch,
    buyerId: defaultBuyerId = "demo-buyer",
    consumerEmail: defaultConsumerEmail = "user@example.com",
    environment: defaultEnvironment = "sandbox",
    waitForBrowser: defaultWaitForBrowser = true,
    waitMs = DEFAULT_WAIT_MS,
    pollMs = DEFAULT_POLL_MS,
    localPreview = false,
    clientMode = "desktop",
  } = options;

  if (!apiBaseUrl) throw new Error("createMcpServer: apiBaseUrl is required");
  if (!requestStore) throw new Error("createMcpServer: requestStore is required");
  const browserAppBaseUrl = appBaseUrl ?? deriveAppBaseUrl(apiBaseUrl);

  const ctx = {
    apiBaseUrl,
    appBaseUrl: browserAppBaseUrl,
    requestStore,
    openBrowser,
    openPreview,
    fetchImpl,
    defaultBuyerId,
    defaultConsumerEmail,
    defaultEnvironment,
    defaultWaitForBrowser,
    waitMs,
    pollMs,
    localPreview,
    clientMode,
  };

  const server = new McpServer(SERVER_INFO, { instructions: buildServerInstructions(ctx.clientMode) });

  const previewToolDescription = `Create a marketing landing page preview from a JSON \`params\` object. Use this when the user asks to create, build, make, draft, or generate a marketing website, landing page, or promo site. The server renders the page from a fixed polished template and returns \`{ siteId, previewUrl }\`; local stdio previews also return \`previewPath\`, and HTTP-style previews also return \`artifactHtml\`.

The agent should then show the preview using the best surface its client supports:
- Codex CLI / terminal clients: paste the returned \`previewUrl\` or \`previewPath\`; if \`opened=true\`, say the browser was opened.
- IDE-style clients with file preview: write the tiny \`artifactHtml\` iframe wrapper to a local HTML file.
- Artifact-capable clients: create a text/html artifact whose body is \`artifactHtml\`.

Use this BEFORE publish_site. The same params produce identical HTML, so previewing and publishing are deterministically the same page.

Do NOT write raw HTML yourself — generate only the params JSON.`;

  server.registerTool(
    "create_marketing_site",
    {
      title: "Create a marketing site preview",
      description: previewToolDescription,
      inputSchema: { params: siteParamsSchema },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => wrapToolResult("create_marketing_site", () => handleRenderMarketingSite(args, ctx)),
  );

  server.registerTool(
    "render_marketing_site",
    {
      title: "Render a marketing site preview",
      description: `${previewToolDescription}\n\nBackward-compatible alias: prefer create_marketing_site for new create/build/make requests.`,
      inputSchema: { params: siteParamsSchema },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => wrapToolResult("render_marketing_site", () => handleRenderMarketingSite(args, ctx)),
  );

  server.registerTool(
    "publish_site",
    {
      title: "Publish a marketing site",
      description: `Commit a marketing landing page to a permanent public URL (\`/s/<siteId>\`) hosted by Vellum. Costs $${PAYMENT_AMOUNT} per published site (one-time, not a subscription — every published site is a fresh $${PAYMENT_AMOUNT} charge).

**CRITICAL — must be the only tool call in your reply.** Never invoke publish_site in parallel with authorize_payment or another publish_site. Wait for this call to return, then decide what to do next in a SUBSEQUENT reply. Batching causes double charges and double payment requests.

Two-step flow:
1. **First call** — pass \`params\` only (NO paymentRequestId). Returns status="payment_required" with a fresh \`paymentRequestId\`, all saved cards, and an "add new card" option. The assistant must ask the user to choose a saved card or add a new one before calling authorize_payment.
2. **Second call** — pass the SAME \`params\` AND the \`paymentRequestId\` from the completed authorize_payment. Publishes the site, returns status="published" with the live URL and the cryptogramId that paid for it. Marks the paymentRequestId as redeemed — it cannot be reused.`,
      inputSchema: {
        params: siteParamsSchema,
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
        paymentRequestId: z.string().optional().describe("Set on the SECOND call (post-payment) to redeem a completed paymentRequestId and publish. Omit on the first call — the server issues a new payment request."),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) => wrapToolResult("publish_site", () => handlePublishSite(args, ctx)),
  );

  server.registerTool(
    "authorize_payment",
    {
      title: "Authorize a $5 hosting payment",
      description: `Capture a one-time $${PAYMENT_AMOUNT} hosting charge for a pending payment request.

**CRITICAL — must be the only tool call in your reply.** Never invoke authorize_payment twice in the same reply (parallel calls open the TouchID iframe twice and force the user to authenticate twice). Never invoke it in parallel with publish_site either. Issue ONE call, wait for the result, then continue in your NEXT reply.

Every payment requires device authentication. Even if the buyer has a previous TouchID-bound intent saved in the wallet, authorize_payment opens the TouchID / FIDO / OTP browser step and creates a fresh intent for this $5 charge before issuing the one-time cryptogram. It uses the selected saved card or opens a card collection page. Transient backend/network interruptions return status='pending' and should be retried with the same paymentRequestId. Terminal errors return isError=true. On success, returns status='completed' with cryptogramId, masked paymentCredential, confirmation, and intentExpiresAt. After completion, call publish_site again with the SAME params AND paymentRequestId to publish the site.`,
      inputSchema: {
        paymentRequestId: z.string().describe("Returned by publish_site when status=payment_required."),
        cardId: z.string().optional().describe("Explicit saved cardId chosen by the user. The server still creates a fresh TouchID-bound intent for every payment."),
        useExistingCard: z.boolean().optional().describe("Set false to force a fresh card collection. Also forces the slow path (new wallet, new TouchID). Defaults to true."),
        forceNewWallet: z.boolean().optional().describe("Deprecated compatibility flag. Payments already always use fresh TouchID + a fresh intent."),
        consumerEmail: z.string().optional().describe("Consumer email used for token enrollment and OTP (slow path only)."),
        waitForBrowser: z.boolean().optional().describe("If true, block until browser steps finish. In Codex CLI, leave this false/omitted so the tool returns waiting_for_card or waiting_for_authentication immediately; then poll by calling again with the same paymentRequestId until the browser posts completion."),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (args) => wrapToolResult("authorize_payment", () => handleAuthorizePayment(args, ctx), args),
  );

  server.registerTool(
    "wallet_status",
    {
      title: "Show the buyer's payment wallet",
      description: `Return the buyer's latest payment wallet: cardId, intentId, and when that TouchID-bound intent expires. This is proof/history only; every new publish still requires fresh TouchID. Use this when the user asks "what intent is saved" or "what card is on file".`,
      inputSchema: {
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => wrapToolResult("wallet_status", () => handleWalletStatus(args, ctx)),
  );

  server.registerTool(
    "authorization_status",
    {
      title: "Show intent authorization limits",
      description: `Return the active TouchID-bound intent and mandate limits. Use when the user asks "how much are you authorized to spend", "what did I authorize", "what is the intent", or "what are the payment limits".`,
      inputSchema: {
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => wrapToolResult("authorization_status", () => handleAuthorizationStatus(args, ctx)),
  );

  server.registerTool(
    "payment_proof",
    {
      title: "Show payment cryptogram proof",
      description: "Return the latest completed payment proof, including intent id and cryptogram details. Use when the user asks to show the cryptogram, payment proof, last cryptogram, or the one-time credential. Pass paymentRequestId to show a specific charge; omit it for the latest buyer proof.",
      inputSchema: {
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
        paymentRequestId: z.string().optional().describe("Optional completed payment request id. If omitted, returns the latest cryptogram proof saved on the buyer wallet."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => wrapToolResult("payment_proof", () => handlePaymentProof(args, ctx)),
  );

  server.registerTool(
    "clear_wallet",
    {
      title: "Clear the payment wallet",
      description: "Forget the buyer's current TouchID-bound intent. The next publish will require a fresh TouchID + new intent. Does NOT cancel the underlying VGS intent on-network; it only removes the local reference so we issue a brand-new one next time.",
      inputSchema: {
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    (args) => wrapToolResult("clear_wallet", () => handleClearWallet(args, ctx)),
  );

  server.registerTool(
    "add_buyer_card",
    {
      title: "Add a saved card",
      description: "Open the card collection form and save a card to the buyer's file without creating a payment request, TouchID intent, cryptogram, or charge. First call without cardRequestId starts the browser flow; if it returns status='waiting_for_card', call add_buyer_card again with the same cardRequestId to poll completion.",
      inputSchema: {
        buyerId: z.string().optional().describe("Merchant-side buyer id. Defaults to demo-buyer."),
        cardRequestId: z.string().optional().describe("Returned by the first add_buyer_card call when status=waiting_for_card. Pass it on later calls to poll the browser session."),
        waitForBrowser: z.boolean().optional().describe("If true, block until the browser card form finishes. In Codex CLI, leave this false/omitted so the tool returns waiting_for_card immediately; then poll by calling add_buyer_card again with cardRequestId."),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) => wrapToolResult("add_buyer_card", () => handleAddBuyerCard(args, ctx)),
  );

  server.registerTool(
    "list_buyer_cards",
    {
      title: "List saved cards",
      description: "Return the cards a buyer has on file (last-4 + brand + opaque cardId). Use this when the user asks 'what cards do I have' or when picking which card to authorize a payment with.",
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

  if (ctx.localPreview) {
    // Local mode (stdio): write HTML to disk and use the preview opener.
    // Codex CLI can enable preview opening while keeping payment handoffs as URLs.
    const localDir = joinPath(tmpdir(), "vellum");
    await mkdir(localDir, { recursive: true });
    const localPath = joinPath(localDir, `${siteId}.html`);
    await writeFile(localPath, html);
    const previewUrl = pathToFileURL(localPath).href;
    const opened = ctx.openPreview(previewUrl);
    return {
      status: "preview",
      siteId,
      previewUrl,
      previewPath: localPath,
      companyName,
      opened,
      nextStep: opened
        ? `Preview opened locally in the user's default browser (${previewUrl}). Wait for them to review it, then ask "Publish for $${PAYMENT_AMOUNT}?" and call publish_site with the SAME params.`
        : `Preview written to ${localPath}. Tell the user the file path or ask them to open ${previewUrl} manually. Then ask "Publish for $${PAYMENT_AMOUNT}?" and call publish_site with the SAME params.`,
    };
  }

  // HTTP mode: store on the server so /preview/<siteId> can serve it.
  await apiFetch(ctx, `/sites`, {
    method: "POST",
    body: { siteId, html, buyerId: ctx.defaultBuyerId, companyName, status: "preview" },
  });

  const previewUrl = `${ctx.appBaseUrl}/preview/${siteId}`;
  // Small, self-contained artifact body — just an iframe pointing at /preview.
  const artifactHtml = `<!doctype html><html><body style="margin:0;padding:0;height:100vh"><iframe src="${previewUrl}" style="width:100%;height:100%;border:0" loading="eager"></iframe></body></html>`;

  return {
    status: "preview",
    siteId,
    previewUrl,
    companyName,
    artifactHtml,
    nextStep: `Show this preview to the user inline, by whichever mechanism your client supports (priority order):
1) Codex CLI / terminal clients: include previewUrl as a clickable link; if the tool says opened=true, tell the user the browser was opened.
2) If you have a Write / file-creation tool with a preview pane (Claude Code, Cursor): write artifactHtml to a file like /tmp/preview-${siteId}.html — your client's preview pane will render it automatically.
3) If you have an artifacts capability (Claude Desktop): create an artifact with type="text/html" and artifactHtml as the body.
4) Otherwise: include previewUrl as a clickable link.

Do NOT paste raw HTML in chat as a code block. After the user reviews, ask "Publish for $${PAYMENT_AMOUNT}?" and call publish_site with the SAME params.`,
  };
}

async function handlePublishSite(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const params = args.params;
  if (!params) throw new Error("params argument is required");

  const html = renderMarketingSite(params);
  const companyName = params.brand?.name ?? null;

  // Path A — second call after authorize_payment: agent passes the
  // paymentRequestId, server validates the charge and publishes.
  if (args.paymentRequestId) {
    const pr = await getPaymentRequestForPublish(ctx, args.paymentRequestId);
    if (!pr) throw new Error(`Unknown or expired paymentRequestId: ${args.paymentRequestId}.`);
    if (pr.status !== "completed") {
      const pendingHint = pr.status === "pending"
        ? " If authorize_payment just returned status=\"completed\", retry publish_site with the same params and paymentRequestId; do NOT call authorize_payment again."
        : "";
      throw new Error(`paymentRequestId ${args.paymentRequestId} has status "${pr.status}", not "completed". Call authorize_payment first unless the charge has already completed.${pendingHint}`);
    }
    if (pr.redeemed) {
      throw new Error(`paymentRequestId ${args.paymentRequestId} was already redeemed for a previous publish. Each published site costs $${PAYMENT_AMOUNT} — call publish_site again WITHOUT paymentRequestId to start a fresh payment.`);
    }
    const siteId = createId("site").replace("site_", "s").slice(0, 8);
    await apiFetch(ctx, `/sites`, {
      method: "POST",
      body: { siteId, html, buyerId, companyName, status: "published" },
    });
    await apiFetch(ctx, `/payment-requests/${encodeURIComponent(args.paymentRequestId)}`, {
      method: "PUT",
      body: { redeemed: true, redeemedAt: Date.now(), siteId },
    });
    const liveUrl = `${ctx.appBaseUrl}/s/${siteId}`;
    const paidCryptogramId = pr.cryptogramId ?? pr.paymentCredential?.cryptogramId ?? null;
    const deployPaymentProof = formatDeployPaymentProof({
      paymentRequestId: args.paymentRequestId,
      cryptogramId: paidCryptogramId,
      paymentCredential: pr.paymentCredential ?? null,
      confirmationStatus: pr.confirmationStatus ?? pr.confirmation?.status ?? null,
    });
    return {
      status: "published",
      siteId,
      url: liveUrl,
      companyName,
      paymentRequestId: args.paymentRequestId,
      amount: pr.amount ?? PAYMENT_AMOUNT,
      currency: pr.currency ?? PAYMENT_CURRENCY,
      cryptogramId: paidCryptogramId,
      paymentCredential: pr.paymentCredential ?? null,
      confirmationStatus: pr.confirmationStatus ?? pr.confirmation?.status ?? null,
      deployPaymentProof,
      nextStep: `Site is live. Your final assistant message MUST announce the URL and include the payment proof block — omitting either is a bug. Print this EXACT message:\n\n✅ Deploy complete — ${liveUrl}\n\n${deployPaymentProof}\n\nDo NOT repeat the payment amount or card id — those were already shown.`,
    };
  }

  // Path B — first call: no paymentRequestId yet. Issue a fresh $5 charge
  // request. Each published site costs $5; subscriptions no longer apply.
  const paymentRequestId = createId("pr").replace("pr_", "pr").slice(0, 10);
  await apiFetch(ctx, `/payment-requests`, {
    method: "POST",
    body: {
      id: paymentRequestId,
      buyerId,
      amount: PAYMENT_AMOUNT,
      currency: PAYMENT_CURRENCY,
      plan: PAYMENT_PLAN,
      reason: `Hosting fee for ${companyName || "marketing site"} — $${PAYMENT_AMOUNT}`,
    },
  });

  const savedCards = decorateSavedCardsForPayment(await getCardsForBuyer(ctx, buyerId), null);
  const savedCard = savedCards[0] ?? null;

  let nextStep;
  if (savedCards.length > 0) {
    const options = savedCards
      .map((card, index) => {
        return `${index + 1}. ${card.label} — cardId="${card.cardId}" (TouchID required)`;
      })
      .concat(`${savedCards.length + 1}. Add a new card`)
      .join("\n");
    nextStep = `Show the user this payment-method list and ask which one to use for the $${PAYMENT_AMOUNT} charge. Do NOT call authorize_payment until the user chooses.\n\n${options}\n\nIf the user chooses a saved card, call authorize_payment with paymentRequestId="${paymentRequestId}" and the chosen cardId. If the user chooses "Add a new card", call authorize_payment with paymentRequestId="${paymentRequestId}" and useExistingCard=false.`;
  } else {
    nextStep = `No card on file — do NOT ask the user for confirmation again (they already approved the $${PAYMENT_AMOUNT} charge). Print this exact line:\n\n"No card on file — opening card form. Enter card details to continue with the $${PAYMENT_AMOUNT} charge."\n\nThen IMMEDIATELY call authorize_payment with paymentRequestId="${paymentRequestId}" and useExistingCard=false. It will return status="waiting_for_card" with a URL — surface that URL to the user, wait ~${BROWSER_HANDOFF_POLL_SECONDS} seconds, then call authorize_payment AGAIN with the same paymentRequestId. The browser posts completion to /api/sessions/:id, so do NOT ask the user to say "done" before polling. When it eventually returns status=completed, call publish_site AGAIN with the SAME params AND paymentRequestId="${paymentRequestId}".`;
  }

  return {
    status: "payment_required",
    paymentRequestId,
    amount: PAYMENT_AMOUNT,
    currency: PAYMENT_CURRENCY,
    plan: PAYMENT_PLAN,
    description: `One-time hosting fee — $${PAYMENT_AMOUNT} for ${companyName || "marketing site"}`,
    savedCard,
    savedCards,
    addNewCardOption: true,
    requiresPaymentMethodSelection: savedCards.length > 0,
    walletReady: false,
    intentExpiresAt: null,
    nextStep,
  };
}

// Netlify Blobs can briefly return the previous "pending" value right after
// authorize_payment writes "completed". The agent publishes immediately after
// payment success, so smooth over that read-after-write window here.
async function getPaymentRequestForPublish(ctx, paymentRequestId) {
  let last = null;
  for (let attempt = 0; attempt < PAYMENT_REQUEST_READ_RETRIES; attempt += 1) {
    last = await apiFetch(ctx, `/payment-requests/${encodeURIComponent(paymentRequestId)}`, { allow404: true });
    if (!last || last.status !== "pending") return last;
    if (attempt < PAYMENT_REQUEST_READ_RETRIES - 1) {
      await sleep(PAYMENT_REQUEST_READ_DELAY_MS);
    }
  }
  return last;
}

async function handleAuthorizePayment(args, ctx) {
  const paymentRequestId = args.paymentRequestId;
  const pr = await apiFetch(ctx, `/payment-requests/${encodeURIComponent(paymentRequestId)}`, { allow404: true });
  if (!pr) throw new Error(`Unknown or expired paymentRequestId: ${paymentRequestId}.`);
  if (pr.status === "completed") {
    return {
      status: "completed",
      paymentRequestId,
      alreadyAuthorized: true,
      cardId: pr.cardId ?? null,
      intentId: pr.intentId ?? null,
      cryptogramId: pr.cryptogramId ?? null,
      paymentCredential: pr.paymentCredential ?? null,
      confirmation: pr.confirmation ?? null,
      confirmationId: pr.confirmationId ?? pr.confirmation?.id ?? null,
      confirmationStatus: pr.confirmationStatus ?? pr.confirmation?.status ?? null,
      confirmedAt: pr.confirmedAt ?? pr.confirmation?.confirmedAt ?? null,
      intentExpiresAt: pr.intentExpiresAt ?? null,
      amount: pr.amount ?? PAYMENT_AMOUNT,
      currency: pr.currency ?? PAYMENT_CURRENCY,
      reusedWallet: pr.reusedWallet ?? null,
      nextStep: `Charge already captured — deploy is MANDATORY. In THIS SAME TURN: print "🚀 Starting deploy…" on its own line, then IMMEDIATELY call publish_site with the SAME params AND paymentRequestId="${paymentRequestId}". Do NOT ask the user for permission. End-of-turn without calling publish_site is a bug.`,
    };
  }

  const buyerId = pr.buyerId || ctx.defaultBuyerId;
  const consumerEmail = args.consumerEmail || ctx.defaultConsumerEmail;
  const waitForBrowser = ctx.clientMode === "codex-cli"
    ? false
    : (args.waitForBrowser ?? ctx.defaultWaitForBrowser);

  // Load flow state early — we may be resuming a waiting_for_cryptogram poll
  // (or any other waiting_for_* state). State survives between non-blocking
  // calls in stdio mode (in-memory) and in HTTP mode (Netlify Blobs).
  const flow = (await ctx.requestStore.get(paymentRequestId)) ?? {
    paymentRequestId, buyerId, status: "running",
  };
  const previousStatus = flow.status;
  flow.status = "running";
  if (args.useExistingCard === false) flow.forceNewCard = true;

  // --- Resume path: cryptogram is being polled. Skip everything before, go
  // straight back to the /cryptograms endpoint with the stored tokenId+intentId.
  if (previousStatus === "waiting_for_cryptogram" && flow.tokenId && flow.intentId) {
    return await attemptCryptogramAndFinalize(ctx, paymentRequestId, flow, pr);
  }
  if (previousStatus === "waiting_for_confirmation" && flow.tokenId && flow.intentId && flow.cryptogramId) {
    return await confirmPaymentAndFinalize(ctx, paymentRequestId, flow, pr);
  }

  const selectedCardId = flow.cardId ?? args.cardId ?? null;
  const isAddingNewCard = Boolean(flow.forceNewCard);
  const isResumingBrowserStep = previousStatus === "waiting_for_card" || previousStatus === "waiting_for_authentication";
  let savedCardsForSelection = null;

  if (!selectedCardId && !isAddingNewCard && !isResumingBrowserStep) {
    savedCardsForSelection = decorateSavedCardsForPayment(await getCardsForBuyer(ctx, buyerId), null);
    if (savedCardsForSelection.length > 0) {
      return paymentMethodRequiredResponse(paymentRequestId, buyerId, pr, savedCardsForSelection);
    }
  }

  // Always run the full ceremony for each payment so TouchID is requested every time.
  let cardId = selectedCardId;
  if (!cardId && !flow.forceNewCard) {
    const cards = savedCardsForSelection
      ?? decorateSavedCardsForPayment(await getCardsForBuyer(ctx, buyerId), null);
    if (cards.length > 0) {
      return paymentMethodRequiredResponse(paymentRequestId, buyerId, pr, cards);
    }
  }

  let collect = flow.collect ?? null;
  if (!cardId && previousStatus === "waiting_for_card" && collect) {
    const cardSession = waitForBrowser
      ? await waitForSession(ctx, collect.sessionId, ctx.waitMs)
      : await apiFetch(ctx, `/sessions/${encodeURIComponent(collect.sessionId)}`, { allow404: true });
    if (!cardSession) {
      flow.status = "waiting_for_card";
      await ctx.requestStore.set(paymentRequestId, flow);
      return waitingResponse("waiting_for_card", paymentRequestId, collect, null,
        collect.opened
          ? "Complete the opened card form and save a card."
          : "Open the collect URL and save a card.");
    }
    cardId = cardSession.cardId;
    if (!cardId) throw new Error("Card collection completed without cardId.");
    await saveCollectedCard(ctx, buyerId, cardSession);
    flow.cardId = cardId;
  }

  if (!cardId) {
    // Deterministic sessionId per paymentRequestId — if the agent calls
    // authorize_payment twice in parallel for the same PR, both calls produce
    // the same collect URL → one server-side session → one card form for the user.
    const sessionId = `collect-${paymentRequestId}`;
    const collectUrl = buildAppUrl(ctx, "/collect.html", { sessionId, buyer_id: buyerId });
    const opened = ctx.openBrowser(collectUrl);
    collect = { sessionId, url: collectUrl, opened };
    flow.collect = collect;

    if (!waitForBrowser) {
      flow.status = "waiting_for_card";
      await ctx.requestStore.set(paymentRequestId, flow);
      return waitingResponse("waiting_for_card", paymentRequestId, collect, null,
        opened
          ? "Complete the opened card form and save a card. The agent should poll authorize_payment again automatically."
          : "Open the collect URL and save a card. The agent should poll authorize_payment again automatically.");
    }
    const cardSession = await waitForSession(ctx, sessionId, ctx.waitMs);
    cardId = cardSession.cardId;
    if (!cardId) throw new Error("Card collection completed without cardId.");
    await saveCollectedCard(ctx, buyerId, cardSession);
    flow.cardId = cardId;
  }

  let tokenId = flow.tokenId;
  if (!tokenId && cardId && !flow.forceNewCard) {
    const wallet = await getWalletState(ctx, buyerId);
    if (wallet?.cardId === cardId && wallet.tokenId) {
      tokenId = wallet.tokenId;
      flow.tokenId = tokenId;
    }
  }
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
        binding.opened
          ? "Complete TouchID / passkey authentication in the opened browser tab."
          : "Open the binding URL and complete TouchID / passkey authentication.");
    }
    assuranceData = bindingSession.assuranceData;
    if (!assuranceData) throw new Error("Device authentication completed without assuranceData.");
    flow.assuranceData = assuranceData;
  }

  if (!assuranceData) {
    // Deterministic sessionId per paymentRequestId — if the agent calls
    // authorize_payment twice in parallel for the same PR, both calls produce
    // the same binding URL → one server-side session → one TouchID prompt for the user.
    const bindingSessionId = `binding-${paymentRequestId}`;
    const bindingUrl = buildAppUrl(ctx, "/binding.html", {
      sessionId: bindingSessionId,
      buyer_id: buyerId,
      tokenId,
      product_name: `${PAYMENT_PLAN}`,
      merchant_name: "Vellum",
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
      binding.opened
        ? "Complete TouchID / passkey authentication in the opened browser tab. The agent should poll authorize_payment again automatically."
        : "Open the binding URL and complete TouchID / passkey authentication. The agent should poll authorize_payment again automatically.");
  }

  if (!assuranceData) {
    const bindingSession = await waitForSession(ctx, binding.sessionId, ctx.waitMs);
    assuranceData = bindingSession.assuranceData;
    if (!assuranceData) throw new Error("Device authentication completed without assuranceData.");
    flow.assuranceData = assuranceData;
  }

  const intent = await createPaymentIntent(ctx, tokenId, assuranceData, pr);
  const intentId = intent?.data?.id;
  if (!intentId) throw new Error(`Intent creation returned no id: ${JSON.stringify(intent)}`);

  flow.cardId = cardId;
  flow.tokenId = tokenId;
  flow.intentId = intentId;
  flow.intentCreatedAt = Date.now();
  flow.intentExpiresAt = Date.now() + INTENT_DURATION_MS;
  flow.reusedWallet = false;
  return await attemptCryptogramAndFinalize(ctx, paymentRequestId, flow, pr);
}

// Shared cryptogram-fetch + finalize step used by both fast and slow paths.
// VGS may need several seconds after intent creation before /cryptograms returns
// the actual cryptogram (it first returns a "pending" shape with only intent_id
// and status). Instead of blocking inside one tool call, we increment a counter
// in flow state and return status="waiting_for_cryptogram" — the agent polls by
// calling authorize_payment again after a short delay.
async function attemptCryptogramAndFinalize(ctx, paymentRequestId, flow, pr) {
  const cryptogram = await getCryptogram(ctx, flow.tokenId, flow.intentId, pr);
  const paymentCredential = cryptogram?.data?.attributes;
  if (!paymentCredential) throw new Error(`Cryptogram response returned no payment credential: ${JSON.stringify(cryptogram)}`);

  const cryptogramId = extractCryptogramId(cryptogram);
  const maskedCredential = maskPaymentCredential(paymentCredential, ctx);

  if (cryptogramId === null) {
    flow.cryptogramAttempts = (flow.cryptogramAttempts ?? 0) + 1;
    if (flow.cryptogramAttempts >= MAX_CRYPTOGRAM_ATTEMPTS) {
      const shape = describeKeyShape(cryptogram).slice(0, 80).join(", ");
      await ctx.requestStore.delete(paymentRequestId);
      throw new Error(`Cryptogram still not ready after ${MAX_CRYPTOGRAM_ATTEMPTS} polling attempts (response shape: ${shape}). VGS may be unavailable — start over with a new publish_site call.`);
    }
    flow.status = "waiting_for_cryptogram";
    await ctx.requestStore.set(paymentRequestId, flow);
    return {
      status: "waiting_for_cryptogram",
      paymentRequestId,
      attempts: flow.cryptogramAttempts,
      maxAttempts: MAX_CRYPTOGRAM_ATTEMPTS,
      retryAfterSeconds: CRYPTOGRAM_POLL_SECONDS,
      message: `Cryptogram is being generated by VGS (poll ${flow.cryptogramAttempts}/${MAX_CRYPTOGRAM_ATTEMPTS}).`,
      nextStep: `⏳ Print this exact line to the user:\n\n⏳ Generating payment cryptogram… (poll ${flow.cryptogramAttempts}/${MAX_CRYPTOGRAM_ATTEMPTS})\n\nThen wait ~${CRYPTOGRAM_POLL_SECONDS} seconds and call authorize_payment again with paymentRequestId="${paymentRequestId}" (no other arguments). The server will retry the VGS cryptogram fetch. Do NOT call publish_site, do NOT call any other Vellum tool — just wait and re-call authorize_payment until it returns status="completed".`,
    };
  }

  flow.cryptogramId = cryptogramId;
  flow.paymentCredential = maskedCredential;
  flow.status = "waiting_for_confirmation";
  await ctx.requestStore.set(paymentRequestId, flow);
  return await confirmPaymentAndFinalize(ctx, paymentRequestId, flow, pr);
}

async function confirmPaymentAndFinalize(ctx, paymentRequestId, flow, pr) {
  const cryptogramId = flow.cryptogramId;
  const maskedCredential = flow.paymentCredential;
  if (!cryptogramId || !maskedCredential) {
    throw new Error(`Cannot confirm payment without cryptogram proof for paymentRequestId ${paymentRequestId}.`);
  }

  const intentExpiresAt = flow.intentExpiresAt ?? (Date.now() + INTENT_DURATION_MS);
  const amount = pr.amount ?? PAYMENT_AMOUNT;
  const currency = pr.currency ?? PAYMENT_CURRENCY;

  let confirmation = flow.confirmation ?? null;
  if (!confirmation) {
    const response = await confirmTransaction(ctx, flow.tokenId, flow.intentId, pr);
    if (!response?.data?.id) throw new Error(`Confirmation returned no id: ${JSON.stringify(response)}`);
    confirmation = confirmationSummaryFromResponse(response, {
      status: "APPROVED",
      type: "PURCHASE",
      amount,
      currency,
    }, Date.now());
    flow.confirmation = confirmation;
    await ctx.requestStore.set(paymentRequestId, flow);
  }

  const completedAt = Date.now();
  const existingWallet = await getWalletState(ctx, flow.buyerId);
  const mandateUsed = flow.reusedWallet ? Number(existingWallet?.mandateUsed ?? 0) + 1 : 1;
  const paymentProof = {
    paymentRequestId,
    buyerId: flow.buyerId,
    cardId: flow.cardId,
    tokenId: flow.tokenId,
    intentId: flow.intentId,
    intentExpiresAt,
    cryptogramId,
    paymentCredential: maskedCredential,
    amount,
    currency,
    completedAt,
    confirmation,
    reusedWallet: Boolean(flow.reusedWallet),
  };
  await saveWalletState(ctx, flow.buyerId, {
    plan: pr.plan,
    amount,
    currency,
    cardId: flow.cardId,
    tokenId: flow.tokenId,
    intentId: flow.intentId,
    intentCreatedAt: flow.intentCreatedAt ?? Date.now(),
    intentExpiresAt,
    authorizedPerChargeAmount: amount,
    authorizedPerChargeCurrency: currency,
    mandateQuantity: MANDATE_QUANTITY,
    mandateUsed,
    mandateRemaining: Math.max(MANDATE_QUANTITY - mandateUsed, 0),
    lastChargedAt: completedAt,
    lastPaymentRequestId: paymentRequestId,
    lastCryptogramId: cryptogramId,
    lastPaymentProof: paymentProof,
  });

  await apiFetch(ctx, `/payment-requests/${encodeURIComponent(paymentRequestId)}`, {
    method: "PUT",
    body: {
      status: "completed",
      completedAt,
      cardId: flow.cardId,
      tokenId: flow.tokenId,
      intentId: flow.intentId,
      intentExpiresAt,
      authorizedPerChargeAmount: amount,
      authorizedPerChargeCurrency: currency,
      mandateQuantity: MANDATE_QUANTITY,
      cryptogramId,
      paymentCredential: maskedCredential,
      confirmation,
      confirmationId: confirmation.id,
      confirmationStatus: confirmation.status,
      confirmedAt: confirmation.confirmedAt,
      reusedWallet: Boolean(flow.reusedWallet),
    },
  });

  await ctx.requestStore.delete(paymentRequestId);

  const reusedWallet = flow.reusedWallet ?? false;
  return {
    status: "completed",
    paymentRequestId,
    cardId: flow.cardId,
    intentId: flow.intentId,
    intentExpiresAt,
    cryptogramId,
    paymentCredential: maskedCredential,
    confirmation,
    confirmationId: confirmation.id,
    confirmationStatus: confirmation.status,
    confirmedAt: confirmation.confirmedAt,
    amount,
    currency,
    reusedWallet,
    nextStep: `Payment is captured — deploy is now MANDATORY. Do all of the following in THIS SAME TURN, in this exact order:\n\n1. Print this EXACT success line:\n\n✅ Payment successful — $${pr.amount ?? PAYMENT_AMOUNT} ${pr.currency ?? PAYMENT_CURRENCY} charged on card ending ${maskedCredential?.dpanLast4 ?? "—"} (cryptogram \`${cryptogramId}\`, fresh TouchID-bound intent valid until ${new Date(intentExpiresAt).toISOString().slice(0, 10)}).\n\n2. On the next line, print exactly:\n\n🚀 Starting deploy…\n\n3. IMMEDIATELY call publish_site with the SAME params AND paymentRequestId="${paymentRequestId}". Do NOT stop, do NOT ask the user for permission — the user already paid, the deploy MUST follow. End-of-turn without calling publish_site is a bug.`,
  };
}

async function handleWalletStatus(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const wallet = await getWalletState(ctx, buyerId);
  if (!wallet || !wallet.intentId) {
    return { buyerId, wallet: null };
  }
  return {
    buyerId,
    wallet: {
      cardId: wallet.cardId,
      intentId: wallet.intentId,
      intentCreatedAt: wallet.intentCreatedAt ?? null,
      intentExpiresAt: wallet.intentExpiresAt ?? null,
      lastChargedAt: wallet.lastChargedAt ?? null,
      usable: isWalletUsable(wallet),
      status: wallet.status ?? "active",
    },
  };
}

async function handleAuthorizationStatus(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const wallet = await getWalletState(ctx, buyerId);
  if (!wallet || !wallet.intentId) {
    return {
      buyerId,
      status: "none",
      authorization: null,
      message: "No TouchID-bound intent is currently saved for this buyer.",
    };
  }

  const amount = wallet.authorizedPerChargeAmount ?? wallet.amount ?? PAYMENT_AMOUNT;
  const currency = wallet.authorizedPerChargeCurrency ?? wallet.currency ?? PAYMENT_CURRENCY;
  const quantity = Number(wallet.mandateQuantity ?? MANDATE_QUANTITY);
  const used = Number(wallet.mandateUsed ?? 0);
  const remaining = Math.max(Number(wallet.mandateRemaining ?? (quantity - used)), 0);

  return {
    buyerId,
    status: isWalletUsable(wallet) ? "active" : "expired_or_inactive",
    authorization: {
      intentId: wallet.intentId,
      cardId: wallet.cardId ?? null,
      tokenId: wallet.tokenId ?? null,
      authorizedPerChargeAmount: amount,
      currency,
      mandateQuantity: quantity,
      mandateUsed: used,
      mandateRemaining: remaining,
      maxTotalAuthorizedAmount: amount * quantity,
      maxRemainingAuthorizedAmount: amount * remaining,
      intentCreatedAt: wallet.intentCreatedAt ?? null,
      intentExpiresAt: wallet.intentExpiresAt ?? null,
      usable: isWalletUsable(wallet),
      status: wallet.status ?? "active",
      lastChargedAt: wallet.lastChargedAt ?? null,
      lastPaymentRequestId: wallet.lastPaymentRequestId ?? null,
      lastCryptogramId: wallet.lastCryptogramId ?? null,
    },
    answer: `Intent ${wallet.intentId} authorizes charges up to $${amount} ${currency} each, for up to ${quantity} charges total. ${remaining} charge(s) remain on this intent, so the remaining authorization envelope is up to $${amount * remaining} ${currency} until ${wallet.intentExpiresAt ? new Date(wallet.intentExpiresAt).toISOString().slice(0, 10) : "the intent expires"}. Current demo policy still requires fresh TouchID and a fresh intent for every new payment.`,
  };
}

async function handlePaymentProof(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;

  if (args.paymentRequestId) {
    const pr = await apiFetch(ctx, `/payment-requests/${encodeURIComponent(args.paymentRequestId)}`, { allow404: true });
    if (!pr) throw new Error(`Unknown or expired paymentRequestId: ${args.paymentRequestId}.`);
    if (pr.status !== "completed") {
      return {
        buyerId: pr.buyerId ?? buyerId,
        status: pr.status ?? "unknown",
        paymentRequestId: args.paymentRequestId,
        proof: null,
        message: `Payment request ${args.paymentRequestId} is not completed yet.`,
      };
    }
    return {
      buyerId: pr.buyerId ?? buyerId,
      status: "completed",
      paymentRequestId: args.paymentRequestId,
      proof: paymentProofFromRecord(pr),
    };
  }

  const wallet = await getWalletState(ctx, buyerId);
  const proof = wallet?.lastPaymentProof ?? null;
  return {
    buyerId,
    status: proof ? "completed" : "none",
    paymentRequestId: proof?.paymentRequestId ?? wallet?.lastPaymentRequestId ?? null,
    proof,
    message: proof ? null : "No completed cryptogram proof is saved for this buyer yet.",
  };
}

async function handleClearWallet(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const response = await apiFetch(ctx, `/subscriptions/${encodeURIComponent(buyerId)}`, { method: "DELETE", allow404: true });
  return { buyerId, cleared: Boolean(response?.deleted) };
}

async function handleAddBuyerCard(args, ctx) {
  const buyerId = args.buyerId || ctx.defaultBuyerId;
  const waitForBrowser = ctx.clientMode === "codex-cli"
    ? false
    : (args.waitForBrowser ?? ctx.defaultWaitForBrowser);

  const cardRequestId = args.cardRequestId || createId("card_request");
  let flow = await ctx.requestStore.get(cardRequestId);

  if (args.cardRequestId && !flow) {
    const recoveredSession = await apiFetch(ctx, `/sessions/${encodeURIComponent(cardSessionId(cardRequestId))}`, { allow404: true });
    if (recoveredSession?.status === "completed") {
      return await completeAddBuyerCard(ctx, { cardRequestId, buyerId }, recoveredSession);
    }
    throw new Error(`Unknown or expired cardRequestId: ${cardRequestId}. Start a new add_buyer_card call without cardRequestId.`);
  }

  if (!flow) {
    const sessionId = cardSessionId(cardRequestId);
    const collectUrl = buildAppUrl(ctx, "/collect.html", { sessionId, buyer_id: buyerId });
    const opened = ctx.openBrowser(collectUrl);
    flow = {
      cardRequestId,
      buyerId,
      status: "waiting_for_card",
      collect: { sessionId, url: collectUrl, opened },
      createdAt: Date.now(),
    };
    await ctx.requestStore.set(cardRequestId, flow);
  }

  const collect = flow.collect;
  if (!collect?.sessionId) throw new Error(`Card request ${cardRequestId} has no browser session.`);

  const cardSession = waitForBrowser
    ? await waitForSession(ctx, collect.sessionId, ctx.waitMs)
    : await apiFetch(ctx, `/sessions/${encodeURIComponent(collect.sessionId)}`, { allow404: true });

  if (!cardSession) {
    await ctx.requestStore.set(cardRequestId, { ...flow, status: "waiting_for_card" });
    return waitingAddCardResponse(cardRequestId, buyerId, collect,
      collect.opened
        ? "Complete the opened card form and save a card."
        : "Open the card form and save a card.");
  }

  return await completeAddBuyerCard(ctx, flow, cardSession);
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

// Wallet state per buyer — the persistent record of {cardId, tokenId, intentId, intentCreatedAt, intentExpiresAt}.
// Stored under /api/subscriptions/<buyerId> (blob endpoint name unchanged for backward compatibility),
// but conceptually it is the buyer's payment-authorization wallet, not a subscription gate.
async function getWalletState(ctx, buyerId) {
  const response = await apiFetch(ctx, `/subscriptions/${encodeURIComponent(buyerId)}`, { allow404: true });
  return response?.subscription ?? null;
}

function isWalletUsable(wallet) {
  if (!wallet) return false;
  if (wallet.status === "canceled") return false;
  if (!wallet.tokenId || !wallet.intentId) return false;
  // The intent's lifetime is the only gate: while the TouchID-bound mandate
  // is within its effective_until window, we can issue fresh cryptograms.
  if (!wallet.intentExpiresAt) return false;
  if (Date.now() > Number(wallet.intentExpiresAt)) return false;
  return true;
}

async function saveWalletState(ctx, buyerId, wallet) {
  return apiFetch(ctx, `/subscriptions/${encodeURIComponent(buyerId)}`, {
    method: "POST",
    body: { ...wallet, status: "active", canceledAt: null },
  });
}

// Extract a display-safe slice of the cryptogram response for the user.
//
// VGS Agentic Tokens response (cryptogram.data.attributes) shape:
//   {
//     intent_id, status,
//     network_token,            // full DPAN (16 digits)
//     exp_month, exp_year,      // numbers
//     last4,                    // string of last 4 of DPAN
//     cryptogram: {             // ← nested
//       value, type, id, expires_at
//     }
//   }
//
// We surface:
//   - dpan: bullet-masked last4 (safe in markdown — no `*` collisions)
//   - expiry MM/YY
//   - cryptogram id (the REAL one, not the intent id)
//   - cryptogram type (DAVV / TAVV / CAVV)
//   - cryptogram value preview (short value shown whole; long values masked)
//   - cryptogram expires_at (how long this one-time credential is valid)
function maskPaymentCredential(credential, ctx = {}) {
  if (!credential || typeof credential !== "object") return null;
  if (process.env.AGENTIC_DEBUG_CRYPTOGRAM === "true") {
    log(`paymentCredential shape: ${describeKeyShape(credential).join(", ")}`);
  }

  const last4 = credential.last4
    ?? (credential.network_token ? String(credential.network_token).replace(/\D/g, "").slice(-4) : null);
  const month = credential.exp_month ?? credential.expiry_month ?? credential.expiration_month ?? null;
  const year = credential.exp_year ?? credential.expiry_year ?? credential.expiration_year ?? null;

  // `cryptogram` is normally an object; tolerate flat-string variants too.
  const cryptoBlob = credential.cryptogram;
  const cryptogramValue = cryptoBlob && typeof cryptoBlob === "object"
    ? cryptoBlob.value ?? null
    : (typeof cryptoBlob === "string" ? cryptoBlob : null);
  const cryptogramType = cryptoBlob && typeof cryptoBlob === "object"
    ? cryptoBlob.type ?? null
    : (credential.cryptogram_type ?? null);
  const cryptogramId = cryptoBlob && typeof cryptoBlob === "object" ? cryptoBlob.id ?? null : null;
  const cryptogramExpiresAt = cryptoBlob && typeof cryptoBlob === "object" ? cryptoBlob.expires_at ?? null : null;

  const valueStr = cryptogramValue === null || cryptogramValue === undefined ? null : String(cryptogramValue);
  // Short sandbox values like "530" — show whole. Long base64 — mask middle.
  const valuePreview = !valueStr
    ? null
    : valueStr.length <= 8
      ? valueStr
      : `${valueStr.slice(0, 4)}…${valueStr.slice(-4)}`;

  return {
    dpanLast4: last4 ? String(last4) : null,
    dpanMasked: last4 ? `••••-••••-••••-${last4}` : null,
    expiry: month && year
      ? `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`
      : null,
    cryptogramId,
    cryptogramExpiresAt,
    cryptogramPreview: valuePreview,
    cryptogramValue: shouldShowFullCryptogram(ctx) ? valueStr : null,
    cryptogramValueShown: shouldShowFullCryptogram(ctx) && Boolean(valueStr),
    type: cryptogramType ? String(cryptogramType) : null,
  };
}

function shouldShowFullCryptogram(ctx = {}) {
  if (process.env.AGENTIC_SHOW_FULL_CRYPTOGRAM !== "true") return false;
  const env = String(ctx.defaultEnvironment ?? process.env.VGS_VAULT_ENV ?? "").toLowerCase();
  return env === "sandbox";
}

// VGS returns cryptogram.data.id = INTENT_ID (echo); the real cryptogram id
// lives at cryptogram.data.attributes.cryptogram.id. Use this helper everywhere
// instead of reaching into .data.id directly.
function extractCryptogramId(cryptogramResponse) {
  return cryptogramResponse?.data?.attributes?.cryptogram?.id
    ?? cryptogramResponse?.data?.attributes?.id
    ?? null;
}

function paymentProofFromRecord(record) {
  return {
    paymentRequestId: record.id ?? record.paymentRequestId ?? null,
    buyerId: record.buyerId ?? null,
    cardId: record.cardId ?? null,
    tokenId: record.tokenId ?? null,
    intentId: record.intentId ?? null,
    intentExpiresAt: record.intentExpiresAt ?? null,
    cryptogramId: record.cryptogramId ?? record.paymentCredential?.cryptogramId ?? null,
    paymentCredential: record.paymentCredential ?? null,
    confirmation: record.confirmation ?? null,
    confirmationId: record.confirmationId ?? record.confirmation?.id ?? null,
    confirmationStatus: record.confirmationStatus ?? record.confirmation?.status ?? null,
    confirmedAt: record.confirmedAt ?? record.confirmation?.confirmedAt ?? null,
    amount: record.amount ?? PAYMENT_AMOUNT,
    currency: record.currency ?? PAYMENT_CURRENCY,
    completedAt: record.completedAt ?? null,
    reusedWallet: record.reusedWallet ?? null,
  };
}

function describeKeyShape(obj, prefix = "", depth = 0, out = []) {
  if (!obj || typeof obj !== "object" || depth > 4) return out;
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(`${path}{}`);
      describeKeyShape(value, path, depth + 1, out);
    } else {
      out.push(`${path}:${Array.isArray(value) ? "array" : typeof value}`);
    }
  }
  return out;
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

function decorateSavedCardsForPayment(cards, wallet) {
  const walletUsable = isWalletUsable(wallet);
  const walletExpiresAt = wallet?.intentExpiresAt ? Number(wallet.intentExpiresAt) : null;
  const walletExpiresAtIso = walletExpiresAt
    ? new Date(walletExpiresAt).toISOString().slice(0, 10)
    : null;

  return cards.map((card) => {
    const isWalletCard = Boolean(wallet?.cardId && card.cardId === wallet.cardId);
    return {
      ...card,
      label: formatCardLabel(card),
      isWalletCard,
      walletReady: Boolean(isWalletCard && walletUsable),
      intentExpiresAt: isWalletCard ? walletExpiresAtIso : null,
    };
  });
}

async function completeAddBuyerCard(ctx, flow, cardSession) {
  const buyerId = flow.buyerId || cardSession.buyerId || ctx.defaultBuyerId;
  const card = await saveCollectedCard(ctx, buyerId, cardSession);
  await ctx.requestStore.delete(flow.cardRequestId);
  return {
    status: "completed",
    cardRequestId: flow.cardRequestId,
    buyerId,
    card,
    nextStep: `Card saved for ${buyerId}. You can call list_buyer_cards to show all saved cards.`,
  };
}

async function saveCollectedCard(ctx, buyerId, cardSession) {
  const card = cardSurfaceFromSession(cardSession);
  if (!card.cardId) throw new Error("Card collection completed without cardId.");
  const response = await apiFetch(ctx, `/merchant/cards/${encodeURIComponent(buyerId)}`, {
    method: "POST",
    body: card,
  });
  const savedCard = Array.isArray(response?.cards)
    ? response.cards.find((c) => c.cardId === card.cardId)
    : null;
  const displayCard = savedCard ?? {
    cardId: card.cardId,
    lastFour: card.lastFour,
    brand: card.brand,
    expMonth: card.expMonth,
    expYear: card.expYear,
  };
  return { ...displayCard, label: formatCardLabel(displayCard) };
}

function cardSurfaceFromSession(cardSession) {
  return {
    cardId: cardSession.cardId ?? null,
    lastFour: cardSession.lastFour ?? null,
    brand: cardSession.brand ?? null,
    expMonth: cardSession.expMonth ?? null,
    expYear: cardSession.expYear ?? null,
    bin: cardSession.bin ?? null,
    first8: cardSession.first8 ?? null,
  };
}

function cardSessionId(cardRequestId) {
  return `add-card-${cardRequestId}`;
}

async function enrollAgenticToken(ctx, cardId, consumerEmail) {
  return apiFetch(ctx, `/cards/${encodeURIComponent(cardId)}/agentic-tokens`, {
    method: "POST",
    body: { data: { type: "agentic_tokens", attributes: { consumer_email: consumerEmail } } },
  });
}

async function createPaymentIntent(ctx, tokenId, assuranceData, paymentRequest) {
  const effectiveUntil = new Date(Date.now() + INTENT_DURATION_MS).toISOString();
  return apiFetch(ctx, `/intents?tokenId=${encodeURIComponent(tokenId)}`, {
    method: "POST",
    body: {
      data: {
        type: "intents",
        attributes: {
          consumer_prompt: `Authorize Vellum hosting — up to ${MANDATE_QUANTITY} site publishes at $${paymentRequest.amount} each`,
          assurance_data: assuranceData,
          mandates: [{
            description: `Per-site hosting fee — Vellum`,
            merchant_category: "Web hosting",
            preferred_merchant_name: "Vellum",
            merchant_category_code: "4816",
            decline_threshold: {
              amount: paymentRequest.amount,
              currency_code: paymentRequest.currency,
            },
            effective_until: effectiveUntil,
            quantity: MANDATE_QUANTITY,
          }],
        },
      },
    },
  });
}

async function getCryptogram(ctx, tokenId, intentId, paymentRequest) {
  // Single POST. Retry semantics live at the tool-call level via the
  // "waiting_for_cryptogram" state — the agent polls by calling authorize_payment
  // again after a few seconds. This keeps each HTTP function call short enough
  // to fit inside Netlify's 10–26s timeout.
  const response = await apiFetch(ctx, `/cryptograms?tokenId=${encodeURIComponent(tokenId)}&intentId=${encodeURIComponent(intentId)}`, {
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
            merchant_url: "https://vellum.example",
            merchant_name: "Vellum",
          }],
        },
      },
    },
  });
  // Set AGENTIC_DEBUG_CRYPTOGRAM=true to dump the response shape (keys only,
  // no sensitive values) to stderr so we can refine maskPaymentCredential.
  if (process.env.AGENTIC_DEBUG_CRYPTOGRAM === "true" && response) {
    log(`cryptogram response shape: ${describeKeyShape(response).slice(0, 60).join(", ")}`);
  }
  return response;
}

async function confirmTransaction(ctx, tokenId, intentId, paymentRequest) {
  const amount = paymentRequest.amount ?? PAYMENT_AMOUNT;
  const currency = paymentRequest.currency ?? PAYMENT_CURRENCY;
  return apiFetch(ctx, `/confirmations?tokenId=${encodeURIComponent(tokenId)}&intentId=${encodeURIComponent(intentId)}`, {
    method: "POST",
    body: {
      data: {
        type: "confirmations",
        attributes: {
          confirmation_data: [{
            payment_confirmation_data: {
              transaction_status: "APPROVED",
              transaction_timestamp: String(Math.floor(Date.now() / 1000)),
              transaction_type: "PURCHASE",
              transaction_amount: {
                transaction_amount: formatAmount(amount),
                transaction_currency_code: currency,
              },
            },
          }],
        },
      },
    },
  });
}

function confirmationSummaryFromResponse(response, requested, confirmedAt) {
  const attrs = response?.data?.attributes ?? {};
  return {
    id: response?.data?.id ?? null,
    type: response?.data?.type ?? null,
    status: attrs.status ?? attrs.transaction_status ?? requested.status,
    transactionType: attrs.transaction_type ?? requested.type,
    amount: requested.amount,
    currency: requested.currency,
    confirmedAt: new Date(confirmedAt).toISOString(),
  };
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

// Strip lone UTF-16 surrogates. Some downstream JSON parsers (Netlify
// Functions runtime, certain VGS endpoints) reject lone surrogates in string
// fields with "no low surrogate in string" / "no high surrogate" errors.
// LLM-generated content occasionally produces these — e.g. an emoji whose
// high surrogate survived intact but the low surrogate got mangled in
// transport. Replace any orphaned half with U+FFFD (replacement char) so the
// request body is always valid UTF-16.
function sanitizeSurrogates(value) {
  if (typeof value === "string") {
    return value.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
  }
  if (Array.isArray(value)) return value.map(sanitizeSurrogates);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeSurrogates(v);
    return out;
  }
  return value;
}

async function apiFetch(ctx, path, { method = "GET", body, allow404 = false } = {}) {
  const url = `${ctx.apiBaseUrl}${path}`;
  let response;
  try {
    response = await ctx.fetchImpl(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(sanitizeSurrogates(body)) } : {}),
    });
  } catch (err) {
    throw new ApiFetchError(`${method} ${path} network failed: ${err.message}`, {
      method,
      path,
      cause: err,
      transient: isTransientNetworkError(err),
    });
  }

  let text = "";
  try {
    text = await response.text();
  } catch (err) {
    throw new ApiFetchError(`${method} ${path} response read failed: ${err.message}`, {
      method,
      path,
      status: response.status,
      cause: err,
      transient: true,
    });
  }
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    throw new ApiFetchError(`${method} ${path} failed (${response.status}): ${text}`, {
      method,
      path,
      status: response.status,
      transient: isTransientHttpStatus(response.status),
    });
  }
  return data;
}

class ApiFetchError extends Error {
  constructor(message, { method, path, status, transient = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ApiFetchError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.transient = transient;
  }
}

function isTransientHttpStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function isTransientNetworkError(err) {
  const parts = [
    err?.name,
    err?.message,
    err?.code,
    err?.cause?.name,
    err?.cause?.message,
    err?.cause?.code,
  ].filter(Boolean).join(" ");
  return /(terminated|fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR|aborted|timeout)/i.test(parts);
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

function paymentMethodRequiredResponse(paymentRequestId, buyerId, paymentRequest, savedCards) {
  const options = savedCards
    .map((card, index) => `${index + 1}. ${card.label} — cardId="${card.cardId}" (TouchID required)`)
    .concat(`${savedCards.length + 1}. Add a new card`)
    .join("\n");

  return {
    status: "payment_method_required",
    paymentRequestId,
    buyerId,
    amount: paymentRequest.amount ?? PAYMENT_AMOUNT,
    currency: paymentRequest.currency ?? PAYMENT_CURRENCY,
    savedCards,
    addNewCardOption: true,
    retryAfterSeconds: null,
    nextStep: `Ask the user which payment method to use for this $${paymentRequest.amount ?? PAYMENT_AMOUNT} charge. Do NOT pick a card silently.\n\n${options}\n\nIf the user chooses a saved card, call authorize_payment again with paymentRequestId="${paymentRequestId}" and the chosen cardId. If the user chooses "Add a new card", call authorize_payment again with paymentRequestId="${paymentRequestId}" and useExistingCard=false.`,
  };
}

function waitingResponse(status, paymentRequestId, collect, binding, message) {
  const url = collect?.url || binding?.url || null;
  return {
    status,
    paymentRequestId,
    collect,
    binding,
    message,
    retryAfterSeconds: BROWSER_HANDOFF_POLL_SECONDS,
    nextStep: `Surface the browser URL${url ? ` (${url})` : ""}, wait ~${BROWSER_HANDOFF_POLL_SECONDS} seconds, then call authorize_payment again with paymentRequestId="${paymentRequestId}". Do not ask the user to say "done"; the browser page posts completion to /api/sessions/:id and this tool reads it automatically on the next call.`,
  };
}

function waitingAddCardResponse(cardRequestId, buyerId, collect, message) {
  return {
    status: "waiting_for_card",
    cardRequestId,
    buyerId,
    collect,
    message,
    retryAfterSeconds: BROWSER_HANDOFF_POLL_SECONDS,
    nextStep: `Surface the browser URL (${collect.url}), wait ~${BROWSER_HANDOFF_POLL_SECONDS} seconds, then call add_buyer_card again with cardRequestId="${cardRequestId}". Do not ask the user to say "done"; the browser page posts completion to /api/sessions/:id and this tool reads it automatically on the next call.`,
  };
}

// --- Result formatting ---

async function wrapToolResult(name, fn, args = {}) {
  try {
    const structuredContent = await fn();
    return {
      content: [{ type: "text", text: formatToolText(name, structuredContent) }],
      structuredContent,
      isError: false,
    };
  } catch (err) {
    if (name === "authorize_payment" && isRecoverableAuthorizePaymentError(err)) {
      const structuredContent = recoverableAuthorizePaymentResult(args, err);
      return {
        content: [{ type: "text", text: formatToolText(name, structuredContent) }],
        structuredContent,
        isError: false,
      };
    }
    return {
      content: [{ type: "text", text: `❌ **${name}** failed\n\n${err.message}` }],
      structuredContent: { error: err.message },
      isError: true,
    };
  }
}

function isRecoverableAuthorizePaymentError(err) {
  return err?.transient === true || isTransientNetworkError(err);
}

function recoverableAuthorizePaymentResult(args, err) {
  const paymentRequestId = args?.paymentRequestId ?? null;
  const retryInstruction = paymentRequestId
    ? `wait ~${TRANSIENT_AUTHORIZE_RETRY_SECONDS} seconds and call authorize_payment again with paymentRequestId="${paymentRequestId}" and the same arguments.`
    : `wait ~${TRANSIENT_AUTHORIZE_RETRY_SECONDS} seconds and call authorize_payment again with the same arguments.`;
  return {
    status: "pending",
    paymentRequestId,
    recoverable: true,
    reason: "transient_error",
    retryAfterSeconds: TRANSIENT_AUTHORIZE_RETRY_SECONDS,
    error: err.message,
    nextStep: `Do not report this as a failed payment. This is a recoverable backend/network interruption; ${retryInstruction}`,
  };
}

function formatToolText(name, result) {
  if (name === "create_marketing_site" || name === "render_marketing_site") return formatRenderSite(result);
  if (name === "publish_site") return formatPublishSite(result);
  if (name === "authorize_payment") return formatAuthorizePayment(result);
  if (name === "wallet_status") return formatWalletStatus(result);
  if (name === "authorization_status") return formatAuthorizationStatus(result);
  if (name === "payment_proof") return formatPaymentProof(result);
  if (name === "clear_wallet") return formatClearWallet(result);
  if (name === "add_buyer_card") return formatAddBuyerCard(result);
  if (name === "list_buyer_cards") return formatBuyerCards(result);
  if (name === "forget_card") return formatForgetCard(result);
  return JSON.stringify(result);
}

function formatRenderSite(result) {
  if (result.previewPath) {
    return [
      `🎨 Site rendered for **${result.companyName ?? "your site"}** — siteId \`${result.siteId}\``,
      ``,
      result.opened
        ? `Preview opened in the user's browser.`
        : `Preview was written locally. In CLI environments, show this path/URL to the user instead of claiming the browser opened.`,
      ``,
      "| | |",
      "|---|---|",
      `| Preview file | \`${result.previewPath}\` |`,
      `| Preview URL | ${result.previewUrl} |`,
      `| Browser opened | ${result.opened ? "yes" : "no"} |`,
      ``,
      `After the user reviews it, ask: "Publish for $${PAYMENT_AMOUNT}?" Wait for explicit yes before calling publish_site.`,
      ``,
      `_${result.nextStep}_`,
    ].join("\n");
  }

  // Directive in position 1: the model reads tool results before composing its
  // reply, so this is where to put environment-aware guidance about how to
  // surface the preview to the user.
  return [
    `🎨 Site rendered for **${result.companyName ?? "your site"}** — siteId \`${result.siteId}\``,
    ``,
    `**To show this preview to the user, pick the path that matches your environment (in priority order):**`,
    ``,
    `1. **Codex CLI / terminal clients**: paste \`${result.previewUrl}\` as a clickable link; if the tool says \`opened=true\`, tell the user the browser was opened.`,
    `2. **Claude Code / Cursor / IDE-style clients with a preview pane**: write the \`artifactHtml\` string to a file in your workspace (e.g. \`/tmp/preview-${result.siteId}.html\` or \`./preview.html\`), then briefly mention the file path.`,
    `3. **Claude Desktop / Claude.ai web (artifacts capability)**: create an artifact with type="text/html" whose body is the \`artifactHtml\` string. Claude will open it in the side panel.`,
    `4. **No Write, no artifacts**: paste \`${result.previewUrl}\` as a clickable link in your reply — the user can open it in a browser tab.`,
    ``,
    `Do NOT paste raw HTML into chat as a code block — that's the worst UX. After showing the preview, ask: "Publish for $${PAYMENT_AMOUNT}?" Wait for explicit yes before calling publish_site.`,
    ``,
    `Preview URL (always available as a fallback): ${result.previewUrl}`,
  ].join("\n");
}

function formatPublishSite(result) {
  if (result.status === "published") {
    // Live full-page screenshot of the just-published site.
    const screenshot = `https://api.microlink.io/?url=${encodeURIComponent(result.url)}&screenshot=true&meta=false&embed=screenshot.url&viewport.width=1280&viewport.height=800`;
    const lines = [
      `🚀 **Site published**`,
      "",
      `![Live site](${screenshot})`,
      "",
      "| | |",
      "|---|---|",
      `| Site | \`${result.siteId}\` |`,
      `| Live URL | **${result.url}** |`,
    ];
    if (result.cryptogramId) lines.push(`| Cryptogram | \`${result.cryptogramId}\` |`);
    if (result.deployPaymentProof) {
      lines.push(
        "",
        "**Payment proof**",
        "",
        result.deployPaymentProof,
      );
    }
    lines.push("", `_${result.nextStep}_`);
    return lines.join("\n");
  }
  if (result.status === "payment_required") {
    const savedCards = Array.isArray(result.savedCards)
      ? result.savedCards
      : (result.savedCard ? [result.savedCard] : []);
    const lines = [
      `💳 **Payment required — $${result.amount} per published site**`,
      "",
      "| | |",
      "|---|---|",
      `| Plan | ${result.plan} |`,
      `| Amount | **$${result.amount} ${result.currency}** (one-time) |`,
      `| Payment request | \`${result.paymentRequestId}\` |`,
      `| Saved cards | ${savedCards.length > 0 ? `${savedCards.length} on file` : "_none — collection step required_"} |`,
      `| TouchID | fresh authentication required for this publish |`,
      "",
    ];
    if (savedCards.length > 0) {
      lines.push(
        `**Choose a payment method**`,
        "",
        formatPaymentMethodTable(savedCards),
        "",
        `Option **${savedCards.length + 1}**: Add a new card`,
        "",
      );
    }
    lines.push(`_${result.nextStep}_`);
    return lines.join("\n");
  }
  return JSON.stringify(result);
}

function formatPaymentMethodRequired(result) {
  const savedCards = Array.isArray(result.savedCards) ? result.savedCards : [];
  return [
    `💳 **Choose payment method — $${result.amount} ${result.currency}**`,
    "",
    "| | |",
    "|---|---|",
    `| Payment request | \`${result.paymentRequestId}\` |`,
    `| Saved cards | ${savedCards.length} on file |`,
    "",
    formatPaymentMethodTable(savedCards),
    "",
    `Option **${savedCards.length + 1}**: Add a new card`,
    "",
    `_${result.nextStep}_`,
  ].join("\n");
}

function formatPaymentMethodTable(cards) {
  const header = "| # | Card | ID | Next step |\n|---|---|---|---|";
  const rows = cards.map((card, index) => {
    const nextStep = "Fresh TouchID required";
    return `| **${index + 1}** | ${card.label} | \`${card.cardId}\` | ${nextStep} |`;
  });
  return `${header}\n${rows.join("\n")}`;
}

function formatAuthorizePayment(result) {
  if (result.status === "payment_method_required") {
    return formatPaymentMethodRequired(result);
  }

  if (result.status === "pending" && result.recoverable) {
    const retry = result.retryAfterSeconds ?? TRANSIENT_AUTHORIZE_RETRY_SECONDS;
    return [
      `⏳ **Authorization still pending**`,
      "",
      `A temporary backend/network interruption occurred while checking or advancing the payment flow.`,
      "",
      "| | |",
      "|---|---|",
      `| Payment request | \`${result.paymentRequestId ?? "—"}\` |`,
      `| Retry in | ~${retry}s |`,
      `| Detail | \`${result.error ?? "transient error"}\` |`,
      "",
      `Wait ~${retry}s, then call authorize_payment again with the same paymentRequestId. Do not present this as a failed payment.`,
      "",
      `_${result.nextStep}_`,
    ].join("\n");
  }

  if (result.status === "completed") {
    const cred = result.paymentCredential ?? {};
    const lines = [
      `✅ **Payment captured — $${result.amount ?? PAYMENT_AMOUNT} ${result.currency ?? PAYMENT_CURRENCY}**`,
      "",
      "| | |",
      "|---|---|",
      `| Card | \`${result.cardId ?? "—"}\` |`,
      `| Intent | \`${result.intentId ?? "—"}\` (fresh — created by this TouchID) |`,
      `| **Cryptogram** | \`${result.cryptogramId ?? "—"}\` — **one-time, single-use** |`,
    ];
    if (cred.dpanMasked) lines.push(`| DPAN | \`${cred.dpanMasked}\` |`);
    if (cred.expiry) lines.push(`| DPAN expiry | ${cred.expiry} |`);
    if (cred.cryptogramPreview) lines.push(`| Cryptogram value | \`${cred.cryptogramPreview}\` _(masked)_ |`);
    if (cred.type) lines.push(`| Cryptogram type | ${cred.type} |`);
    if (cred.cryptogramExpiresAt) lines.push(`| Cryptogram valid until | ${cred.cryptogramExpiresAt} _(this one-time credential)_ |`);
    if (result.confirmationStatus) lines.push(`| Confirmation | ${result.confirmationStatus} |`);
    if (result.confirmationId) lines.push(`| Confirmation response | \`${result.confirmationId}\` |`);
    if (result.confirmedAt) lines.push(`| Confirmed at | ${result.confirmedAt} |`);
    if (result.intentExpiresAt) {
      const dateStr = new Date(result.intentExpiresAt).toISOString().slice(0, 10);
      lines.push(`| Intent valid until | **${dateStr}** (fresh — created by this TouchID) |`);
    }
    lines.push("", `_${result.nextStep}_`);
    return lines.join("\n");
  }
  if (result.status === "waiting_for_card" || result.status === "waiting_for_authentication") {
    const handoff = result.collect || result.binding || {};
    const url = handoff.url;
    const browserLine = handoff.opened
      ? "Browser opened. Complete this step there:"
      : result.status === "waiting_for_card"
        ? "Open the card form in your browser:"
        : "Complete device authentication (TouchID / passkey) in your browser:";
    const niceStatus = result.status.replace(/_/g, " ");
    const msg = result.message ? `\n\n${result.message}` : "";
    const retry = result.retryAfterSeconds ?? BROWSER_HANDOFF_POLL_SECONDS;
    return `⏳ **${niceStatus}**\n\n${browserLine}\n${url}${msg}\n\nWait ~${retry}s, then call authorize_payment again with the same paymentRequestId. Do not ask the user to say "done"; completion is read automatically from the browser session.`;
  }
  if (result.status === "waiting_for_cryptogram") {
    const lines = [
      `⏳ **Cryptogram generating** — poll ${result.attempts}/${result.maxAttempts}`,
      "",
      `VGS needs a moment to generate the one-time cryptogram for this $${PAYMENT_AMOUNT} charge. Wait ~${result.retryAfterSeconds}s and call authorize_payment again with the same paymentRequestId.`,
      "",
      `_${result.nextStep}_`,
    ];
    return lines.join("\n");
  }
  return JSON.stringify(result);
}

function formatWalletStatus(result) {
  if (!result.wallet) return `💳 No payment wallet for \`${result.buyerId}\` — the next publish will require a fresh TouchID.`;
  const w = result.wallet;
  const expiresStr = w.intentExpiresAt ? new Date(w.intentExpiresAt).toISOString().slice(0, 10) : "—";
  return [
    `💳 **Wallet for \`${result.buyerId}\`**`,
    "",
    "| | |",
    "|---|---|",
    `| Card | \`${w.cardId ?? "—"}\` |`,
    `| Intent | \`${w.intentId}\` |`,
    `| Intent valid until | **${expiresStr}** |`,
    `| Status | ${w.usable ? "valid — stored for proof/history; next publish still requires fresh TouchID" : "expired or inactive — next publish requires fresh TouchID"} |`,
  ].join("\n");
}

function formatAuthorizationStatus(result) {
  if (!result.authorization) {
    return `💳 No active authorization intent for \`${result.buyerId}\`.`;
  }
  const a = result.authorization;
  const expiresStr = a.intentExpiresAt ? new Date(a.intentExpiresAt).toISOString().slice(0, 10) : "—";
  return [
    `🔐 **Authorization for \`${result.buyerId}\`**`,
    "",
    result.answer,
    "",
    "| | |",
    "|---|---|",
    `| Intent | \`${a.intentId}\` |`,
    `| Authorized per charge | **$${a.authorizedPerChargeAmount} ${a.currency}** |`,
    `| Mandate quantity | ${a.mandateQuantity} charge(s) |`,
    `| Used / remaining | ${a.mandateUsed} used / ${a.mandateRemaining} remaining |`,
    `| Remaining envelope | up to **$${a.maxRemainingAuthorizedAmount} ${a.currency}** across remaining charges |`,
    `| Intent valid until | **${expiresStr}** |`,
    `| Last cryptogram | ${a.lastCryptogramId ? `\`${a.lastCryptogramId}\`` : "—"} |`,
    `| Status | ${a.usable ? "active — stored for proof/history; new payments still require fresh TouchID" : "not currently usable"} |`,
  ].join("\n");
}

function formatPaymentProof(result) {
  if (!result.proof) {
    return result.message ?? `No completed payment proof for \`${result.buyerId}\`.`;
  }
  const p = result.proof;
  const cred = p.paymentCredential ?? {};
  const lines = [
    `🧾 **Payment proof for \`${result.buyerId}\`**`,
    "",
    "| | |",
    "|---|---|",
    `| Payment request | \`${p.paymentRequestId ?? result.paymentRequestId ?? "—"}\` |`,
    `| Amount | **$${p.amount ?? PAYMENT_AMOUNT} ${p.currency ?? PAYMENT_CURRENCY}** |`,
    `| Intent | \`${p.intentId ?? "—"}\` |`,
    `| Cryptogram | \`${p.cryptogramId ?? cred.cryptogramId ?? "—"}\` |`,
  ];
  if (cred.type) lines.push(`| Type | ${cred.type} |`);
  if (cred.cryptogramValueShown && cred.cryptogramValue) {
    lines.push(`| Cryptogram value | \`${cred.cryptogramValue}\` |`);
  } else if (cred.cryptogramPreview) {
    lines.push(`| Cryptogram value | \`${cred.cryptogramPreview}\` _(masked)_ |`);
  }
  if (cred.dpanMasked) lines.push(`| DPAN | \`${cred.dpanMasked}\` |`);
  if (cred.expiry) lines.push(`| DPAN expiry | ${cred.expiry} |`);
  if (cred.cryptogramExpiresAt) lines.push(`| Cryptogram valid until | ${cred.cryptogramExpiresAt} |`);
  if (p.confirmationStatus ?? p.confirmation?.status) lines.push(`| Confirmation | ${p.confirmationStatus ?? p.confirmation.status} |`);
  if (p.confirmationId ?? p.confirmation?.id) lines.push(`| Confirmation response | \`${p.confirmationId ?? p.confirmation.id}\` |`);
  if (p.confirmedAt ?? p.confirmation?.confirmedAt) lines.push(`| Confirmed at | ${p.confirmedAt ?? p.confirmation.confirmedAt} |`);
  if (p.intentExpiresAt) lines.push(`| Intent valid until | ${new Date(p.intentExpiresAt).toISOString().slice(0, 10)} |`);
  if (p.completedAt) lines.push(`| Captured at | ${new Date(p.completedAt).toISOString()} |`);
  return lines.join("\n");
}

function formatDeployPaymentProof({ paymentRequestId, cryptogramId, paymentCredential, confirmationStatus }) {
  const cred = paymentCredential ?? {};
  return [
    `Payment proof for ${paymentRequestId}:`,
    "",
    `${cryptogramId ?? cred.cryptogramId ?? "—"}`,
    "",
    "Details:",
    "",
    `- Type: ${cred.type ?? "—"}`,
    `- DPAN: ${cred.dpanMasked ?? "—"}`,
    `- DPAN expiry: ${cred.expiry ?? "—"}`,
    `- Expires: ${cred.cryptogramExpiresAt ?? "—"}`,
    `- Confirmation status: ${confirmationStatus ?? "—"}`,
  ].join("\n");
}

function formatClearWallet(result) {
  return result.cleared
    ? `🗑️ Wallet cleared for \`${result.buyerId}\` — next publish will trigger a fresh TouchID.`
    : `ℹ️ No wallet on file for \`${result.buyerId}\`.`;
}

function formatAddBuyerCard(result) {
  if (result.status === "waiting_for_card") {
    const handoff = result.collect || {};
    const browserLine = handoff.opened
      ? "Browser opened. Complete the card form there:"
      : "Open the card form in your browser:";
    const retry = result.retryAfterSeconds ?? BROWSER_HANDOFF_POLL_SECONDS;
    return [
      `⏳ **Waiting for card**`,
      "",
      browserLine,
      handoff.url,
      result.message ? `\n${result.message}` : "",
      "",
      `Wait ~${retry}s, then call add_buyer_card again with \`cardRequestId="${result.cardRequestId}"\`. Do not ask the user to say "done"; completion is read automatically from the browser session.`,
    ].join("\n");
  }

  if (result.status === "completed") {
    return [
      `💳 **Card saved for \`${result.buyerId}\`**`,
      "",
      "| | |",
      "|---|---|",
      `| Card | ${result.card.label} |`,
      `| ID | \`${result.card.cardId}\` |`,
      "",
      `_${result.nextStep}_`,
    ].join("\n");
  }

  return JSON.stringify(result);
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
  // Bullet characters survive markdown rendering; asterisks get eaten as bold
  // markers (e.g. `****-****-****-1569` parses as **bold-empty**`-`**bold-empty**`...` → `--1569`).
  const number = card.lastFour ? `••••-••••-••••-${card.lastFour}` : `…${card.cardId.slice(-4)}`;
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
  process.stderr.write(`[vellum] ${message}\n`);
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
