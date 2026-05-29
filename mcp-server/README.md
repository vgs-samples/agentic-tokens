# Vellum — MCP Server

Quick-start demo of a fictional startup: an AI agent can spin up a marketing landing page for the user, the agency charges a one-time $5 hosting fee per published site, and the payment is authorized via VGS Agentic Tokens (TouchID-bound intent + network cryptogram).

The MCP server exposes the agency's product surface; the React app on the same site renders the hosted pages and handles the device-binding step.

## What's in the box

- **Site preview:** `create_marketing_site` builds the preview; `render_marketing_site` is the older alias.
- **Publishing:** `publish_site` starts the $5 publish flow, then publishes after payment succeeds.
- **Payment:** `authorize_payment` collects a card if needed, asks for TouchID / FIDO / OTP, creates a fresh intent, gets a cryptogram, and confirms the charge.
- **Saved cards:** `add_buyer_card`, `list_buyer_cards`, and `forget_card` let the user save, inspect, and remove cards.
- **Wallet and authorization:** `wallet_status`, `authorization_status`, and `clear_wallet` inspect or clear the latest stored intent record.
- **Proof:** `payment_proof` shows the cryptogram and confirmation details for the latest or requested payment.

Built on `@modelcontextprotocol/sdk@^1.29`. Two transports ship together:

- **stdio** — `node mcp-server/src/index.js`, auto-opens browser tabs for collect / binding. Best for desktop MCP clients.
- **HTTP** — deployed at `https://<your-site>/mcp` via `netlify/functions/mcp.js`, stateless, non-blocking. The agent surfaces collect / binding URLs back to the user instead.

## Tool Guide

You normally do not call these tools by hand. The assistant chooses the right tool based on what the user asks for. This section explains what each tool is for and gives human-readable prompts you can use during a demo.

### Build and Preview a Site

Use `create_marketing_site` when the user asks the agent to make, build, draft, or generate a marketing landing page. The tool creates a preview only; it does not charge the card and does not publish anything.

Example prompts:

- "Create a marketing site for Acme Coffee Co."
- "Build a landing page for a premium coffee subscription."
- "Draft a promo site for a boutique hotel."

`render_marketing_site` does the same thing as `create_marketing_site`. It exists as a backward-compatible alias; new demos should prefer `create_marketing_site`.

### Publish a Site

Use `publish_site` after the user has reviewed the preview and explicitly agreed to publish for $5. Publishing is a two-step flow:

1. The first `publish_site` call creates a payment request and returns the saved cards plus an "Add a new card" option.
2. After payment succeeds, the second `publish_site` call publishes the site and returns the live URL plus the payment proof block.

Example prompts:

- "Publish this for $5."
- "Yes, deploy it."
- "Use the Visa ending in 1478."
- "Add a new card for this payment."

### Authorize and Capture Payment

Use `authorize_payment` after `publish_site` says payment is required. The tool handles card collection if needed, asks for TouchID / FIDO / OTP, creates a fresh intent for every payment, gets the cryptogram, sends the confirmation, and returns proof that the $5 payment was captured.

Every new publish requires fresh TouchID, even if the same saved card was used before.

Example prompts:

- "Use the saved Visa."
- "Use the Mastercard ending in 1569."
- "Add a new card."
- "Continue the payment."

If the tool returns a browser URL, the user opens it and completes the browser step. The assistant then polls `authorize_payment` again until the flow completes.

### Saved Cards

Use `add_buyer_card` when the user wants to save a card without charging it. This opens the card collection form and stores the safe card surface: card id, brand, last four, and expiry. It does not create an intent, cryptogram, or payment.

Use `list_buyer_cards` when the user asks what cards are saved. It returns every saved card for the buyer so the user can choose one for payment.

Use `forget_card` when the user wants to remove one saved card, or remove all saved cards for the buyer.

Example prompts:

- "Add a card."
- "Save a new card."
- "Show my saved cards."
- "Remove the Visa ending in 1478."
- "Forget all saved cards."

### Wallet and Authorization Status

Use `wallet_status` when the user asks what latest payment intent or card is stored. The wallet is kept for proof and demo narration. It is not used to skip TouchID; every new payment still creates a fresh intent.

Use `authorization_status` when the user asks about what the latest intent authorized: the per-charge amount, mandate quantity, remaining envelope, and expiry.

Use `clear_wallet` when the user wants to delete the stored latest intent record from the local merchant state. This does not delete saved cards and does not cancel the VGS intent on-network.

Example prompts:

- "What card is on file?"
- "What intent is saved?"
- "How much are you authorized to spend?"
- "What did I authorize?"
- "Clear the wallet."

### Payment Proof and Cryptograms

Use `payment_proof` when the user asks to show the cryptogram or proof for the latest completed payment. The tool can also show proof for a specific payment request id.

The proof includes the payment request id, cryptogram id, cryptogram type, masked DPAN, DPAN expiry, cryptogram expiry, confirmation status, and timestamps. Full cryptogram values are shown only when `AGENTIC_SHOW_FULL_CRYPTOGRAM=true` in sandbox mode.

Example prompts:

- "Show me the cryptogram."
- "Show payment proof."
- "Show the cryptogram for payment pr73d70741."
- "What credential paid for the deploy?"

## Demo script

```text
You: Make me a marketing site for "Acme Coffee Co" — premium coffee with a subscription.

Agent: [create_marketing_site(params)] → preview, sABC123
       Shows previewUrl / previewPath.

       "Shall I publish this for $5?"

You:  yes

Agent: [publish_site(params)] → payment_required, prXYZ

Agent: [authorize_payment(prXYZ)] → waiting_for_card / waiting_for_authentication
       Open the returned URL and complete the browser step.

Agent: [authorize_payment(prXYZ) — polls until browser session completes] → status: completed
       ✅ Payment successful — $5 USD charged on card ending 1234 (cryptogram `cr_...`).

       [publish_site(params, paymentRequestId="prXYZ")] → status: published
       🚀 Live: https://vgs-agentic-tokens.netlify.app/s/sXXX
```

The user clicks the live URL and sees the same page they previewed — now public.

## Where the HTML comes from

The agent does **not** write raw HTML. It sends a small JSON `params` object, and the MCP server renders a fixed, polished template from those params.

This means:
- The generated page shape stays consistent across clients.
- The user previews the rendered page before paying.
- The same params are used for preview and publish.
- After payment, `/s/:id` serves the published site.

## How "the agent auto-proposes payment" works

It's the **402 pattern over MCP**, not prompt engineering:

1. `publish_site(params, …)` returns `{ status: "payment_required", paymentRequestId, amount, savedCards, nextStep }`.
2. If cards are saved, the agent shows all cards plus an "Add a new card" option and waits for the user's choice.
3. After the user chooses, the agent calls `authorize_payment(paymentRequestId, cardId)` for a saved card, or `authorize_payment(paymentRequestId, useExistingCard:false)` to collect a new card. Internally this always runs device binding, creates a fresh intent, gets a cryptogram, and sends the `APPROVED` transaction confirmation.
4. The agent retries `publish_site` with the same params and completed `paymentRequestId`, and gets `status: published`.

The recurring mandate created on the VGS side has:
- `decline_threshold: { amount: 5, currency_code: "USD" }`
- `effective_until: now + 1 year`
- `quantity: 1000` (the effective-until date is the practical limit)
- `preferred_merchant_name: "Vellum"`
- `merchant_category_code: 4816` (Computer Network Services)

Every $5 publish charge asks for TouchID and creates a fresh intent. The latest intent is still stored for proof/status demos, but it is not used to skip biometric authentication.

For stage demos, after a successful payment the user can ask:

```text
How much are you authorized to spend?
Show me the cryptogram.
```

The agent should call `authorization_status` for the first question and `payment_proof` for the second. Full cryptogram values are only shown when `AGENTIC_SHOW_FULL_CRYPTOGRAM=true` and the MCP server is running in sandbox mode; otherwise the value is masked.

## Install in an MCP client

### HTTP — deployed MCP

```json
{
  "mcpServers": {
    "vellum": {
      "type": "http",
      "url": "https://vgs-agentic-tokens.netlify.app/mcp"
    }
  }
}
```

If your client doesn't speak Streamable HTTP yet, use the `mcp-remote` shim:

```json
{
  "mcpServers": {
    "vellum": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://vgs-agentic-tokens.netlify.app/mcp"]
    }
  }
}
```

**HTTP-mode behavior differences:**
- `authorize_payment` is **always non-blocking** — when a browser step is needed, the tool returns `status: waiting_for_card` / `waiting_for_authentication` with the URL inside `content[]`. The agent surfaces the URL, then polls by calling `authorize_payment` again with the same `paymentRequestId`; the browser page posts completion to `/api/sessions/:id`, and the next poll advances the flow automatically.
- Mid-flow state is stored in **Netlify Blobs** (store name `agentic-mcp-flow-state`, 30-minute TTL).

**Quick smoke check** — the endpoint speaks JSON-RPC over POST:

```bash
curl -X POST https://vgs-agentic-tokens.netlify.app/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

You should get back `serverInfo.name = "vellum"`.

### stdio — local install

Desktop MCP clients can use the default stdio entrypoint. It may open browser tabs for preview, card collection, and device binding.

```bash
claude mcp add vellum node /absolute/path/to/agentic-tokens/mcp-server/src/index.js
```

Or via `.mcp.json`:

```json
{
  "mcpServers": {
    "vellum": {
      "command": "node",
      "args": ["/absolute/path/to/agentic-tokens/mcp-server/src/index.js"],
      "env": {
        "AGENTIC_APP_BASE_URL": "https://vgs-agentic-tokens.netlify.app"
      }
    }
  }
}
```

Point `AGENTIC_APP_BASE_URL` at your deployed site so the sites/payment endpoints exist.

### Codex CLI — local install

Codex CLI should run the stdio server in URL-handoff mode. In this mode the server:

- writes rendered previews to `/tmp/vellum/*.html`, opens the preview when possible, and returns a `file://` URL;
- opens collect / binding URLs in the system browser when possible, while still returning the URLs in the tool result;
- does not block inside `authorize_payment` while waiting for the user to finish a browser step. Do not pass `waitForBrowser=true` in Codex CLI; poll `authorize_payment` again with the same `paymentRequestId` instead.

Shareable GitHub install:

```bash
codex mcp remove vellum 2>/dev/null || true
codex mcp add vellum \
  --env AGENTIC_CLIENT_MODE=codex-cli \
  --env AGENTIC_APP_BASE_URL=https://vgs-agentic-tokens.netlify.app \
  -- npx -y github:vgs-samples/agentic-tokens
```

Recommended test prompt:

```text
Use the Vellum MCP server for this. Create a marketing landing page for Acme Coffee Co — premium coffee with a subscription. Call create_marketing_site first and show me the preview URL.
```

To test a branch or tag instead of the default branch, append it to the GitHub spec:

```bash
npx -y github:vgs-samples/agentic-tokens#main
```

Example `~/.codex/config.toml` entry:

```toml
[mcp_servers.vellum]
command = "npx"
args = ["-y", "github:vgs-samples/agentic-tokens"]

[mcp_servers.vellum.env]
AGENTIC_CLIENT_MODE = "codex-cli"
AGENTIC_APP_BASE_URL = "https://vgs-agentic-tokens.netlify.app"
```

Equivalent local direct command for development:

```bash
AGENTIC_CLIENT_MODE=codex-cli node /absolute/path/to/agentic-tokens/mcp-server/src/index.js
```

## Configuration

All optional, set in the MCP client's `env` block.

| Env var | Default | Description |
|---|---:|---|
| `AGENTIC_CLIENT_MODE` | `desktop` | Set `codex-cli` for Codex CLI URL-handoff mode. |
| `AGENTIC_APP_BASE_URL` | `https://localhost:4200` | Browser URL for the React app and the public `/s/:id` endpoint. |
| `AGENTIC_API_BASE_URL` | `${AGENTIC_APP_BASE_URL}/api` | API base used by the MCP server. |
| `AGENTIC_BUYER_ID` | `demo-buyer` | Mock merchant buyer id. |
| `AGENTIC_CONSUMER_EMAIL` | `user@example.com` | Email used for token enrollment / OTP. |
| `AGENTIC_ENVIRONMENT` | `sandbox` | Passed through to the binding page. |
| `AGENTIC_OPEN_BROWSER` | `true` | Set `false` to return card/binding URLs without opening a browser. |
| `AGENTIC_OPEN_PREVIEW` | `true` | Set `false` to write preview files without opening them. |
| `AGENTIC_WAIT_FOR_BROWSER` | `true` desktop, `false` Codex CLI | Set `false` to return `waiting_for_*` statuses immediately instead of polling for browser completion. |
| `AGENTIC_LOCAL_PREVIEW` | `true` | Set `false` to store previews on the backend and return `/preview/<siteId>` plus `artifactHtml`. |
| `AGENTIC_BROWSER_APP` | auto | macOS app name for `open -a`. |
| `AGENTIC_BROWSER_WAIT_MS` | `300000` | Max wait time for browser sessions. |
| `AGENTIC_POLL_MS` | `1500` | Poll interval for browser sessions. |
| `AGENTIC_SHOW_FULL_CRYPTOGRAM` | `false` | Demo-only: when `true` in sandbox, `payment_proof` includes the full cryptogram value. |

## Smoke test

```bash
cd mcp-server
node scripts/smoke.js
```

Spawns a mock backend on an ephemeral port and round-trips `initialize` + `tools/list` + `create_marketing_site` + `publish_site` (expecting `payment_required`) over stdio in Codex CLI mode.
