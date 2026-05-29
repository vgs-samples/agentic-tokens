# Vellum — MCP Server

Quick-start demo of a fictional startup: an AI agent can spin up a marketing landing page for the user, the agency charges a one-time $5 hosting fee per published site, and the payment is authorized via VGS Agentic Tokens (TouchID-bound intent + network cryptogram).

The MCP server exposes the agency's product surface; the React app on the same site renders the hosted pages and handles the device-binding step.

## What's in the box

- **`create_marketing_site(params)`** / **`render_marketing_site(params)`** — renders the first preview from a small JSON params object. `create_marketing_site` is the preferred tool name for Codex CLI because it matches common prompts like "create a marketing site".
- **`publish_site(params, buyerId?, paymentRequestId?)`** — publishes the preview after payment. First call returns `status: payment_required` with a `paymentRequestId`; second call with that completed request publishes `/s/<siteId>`.
- **`authorize_payment(paymentRequestId)`** — triggers card collection when needed, runs device binding (TouchID / FIDO / OTP), and captures a one-time $5 cryptogram-backed charge.
- **`wallet_status(buyerId?)`** / **`clear_wallet(buyerId?)`** — inspect or clear the buyer's reusable TouchID-bound payment intent.
- **`authorization_status(buyerId?)`** — answers prompts like "how much are you authorized to spend?" from the saved intent and mandate limits.
- **`payment_proof(buyerId?, paymentRequestId?)`** — shows the latest or requested cryptogram proof for demo narration.
- **`add_buyer_card(buyerId?, cardRequestId?, waitForBrowser?)`** — opens the card collection form and saves a card without creating a payment request, TouchID intent, cryptogram, or charge.
- **`list_buyer_cards(buyerId?)`** / **`forget_card(buyerId?, cardId?)`** — card management.

Built on `@modelcontextprotocol/sdk@^1.29`. Two transports ship together:

- **stdio** — `node mcp-server/src/index.js`, auto-opens browser tabs for collect / binding. Best for desktop MCP clients.
- **HTTP** — deployed at `https://<your-site>/mcp` via `netlify/functions/mcp.js`, stateless, non-blocking. The agent surfaces collect / binding URLs back to the user instead.

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
3. After the user chooses, the agent calls `authorize_payment(paymentRequestId, cardId)` for a saved card, or `authorize_payment(paymentRequestId, useExistingCard:false)` to collect a new card. Internally this runs device binding when needed, creates/reuses the intent, gets a cryptogram, and sends the `APPROVED` transaction confirmation.
4. The agent retries `publish_site` with the same params and completed `paymentRequestId`, and gets `status: published`.

The recurring mandate created on the VGS side has:
- `decline_threshold: { amount: 5, currency_code: "USD" }`
- `effective_until: now + 1 year`
- `quantity: 1000` (the effective-until date is the practical limit)
- `preferred_merchant_name: "Vellum"`
- `merchant_category_code: 4816` (Computer Network Services)

After the first cryptogram, subsequent $5 publish charges can reuse the same intent until it expires — the assurance is bound to the user's device for the life of the mandate.

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
