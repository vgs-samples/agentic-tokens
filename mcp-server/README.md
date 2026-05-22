# Vellum — MCP Server

Quick-start demo of a fictional startup: an AI agent can spin up a marketing landing page for the user, the agency charges $5/month to host it, and the subscription is authorized via VGS Agentic Tokens (TouchID-bound intent + network cryptogram).

The MCP server exposes the agency's product surface; the React app on the same site renders the hosted pages and handles the device-binding step.

## What's in the box

- **`publish_site(html, companyName?, buyerId?)`** — the agent generates the full HTML itself, renders it as an Artifact in Claude Desktop for the user to preview, then calls this tool to publish. Returns the live `/s/<siteId>` URL on success, or `status: payment_required` with a `paymentRequestId` if the buyer has no active subscription.
- **`authorize_subscription(paymentRequestId)`** — triggers the existing VGS device-binding flow (opens `/binding.html` for TouchID / FIDO / OTP) and creates a recurring intent + cryptogram. Marks the buyer as having an active subscription for 30 days.
- **`list_subscriptions(buyerId?)`** / **`cancel_subscription(buyerId?)`** — read/cancel.
- **`list_buyer_cards(buyerId?)`** / **`forget_card(buyerId?, cardId?)`** — card management.

Built on `@modelcontextprotocol/sdk@^1.29`. Two transports ship together:

- **stdio** — `node mcp-server/src/index.js`, auto-opens browser tabs for collect / binding. Best for desktop MCP clients.
- **HTTP** — deployed at `https://<your-site>/mcp` via `netlify/functions/mcp.js`, stateless, non-blocking. The agent surfaces collect / binding URLs back to the user instead.

## Demo script

```text
You: Make me a marketing site for "Acme Coffee Co" — premium coffee with a subscription.

Agent: [Generates full HTML inline; creates an HTML Artifact]
       Claude Desktop opens the artifact side panel and renders the page live.

       "Shall I publish this for $5/month?"

You:  yes

Agent: [publish_site(html, companyName="Acme Coffee Co")] → payment_required, prXYZ
       "Hosting needs a $5/month Vellum subscription. Approve?"

You:  yes

Agent: [authorize_subscription(prXYZ)] → waiting_for_authentication
       Open the binding URL and complete TouchID:
       https://vgs-agentic-tokens.netlify.app/binding.html?…

You:  [opens, completes TouchID, comes back] "done"

Agent: [authorize_subscription(prXYZ) — resume] → status: completed
       ✅ Subscription active until 2026-06-20.

       [publish_site(html, …) — retry with the SAME html] → status: published
       🚀 Live: https://vgs-agentic-tokens.netlify.app/s/sXXX
```

The user clicks the live URL and sees the same page they previewed in the Artifact panel — now public.

## Where the HTML is generated

The agent (Claude in the chat) writes the full HTML itself, using Tailwind via CDN and picsum images. The MCP server has **no HTML template** — it only stores already-paid-for HTML and hosts it at `/s/:id`.

This means:
- The HTML is generated **client-side** in the user's Claude Desktop session
- The user previews it in the **Artifact panel** before any server contact for the HTML body
- The HTML only reaches the server **after the user confirms publishing**
- After payment, `/s/:id` serves it permanently (24-hour TTL on the Blob)

## How "the agent auto-proposes payment" works

It's the **402 pattern over MCP**, not prompt engineering:

1. `publish_site(html, …)` returns `{ status: "payment_required", paymentRequestId, amount, plan, description, nextStep }`.
2. Any decent LLM reads `nextStep` and surfaces the question to the user.
3. After the user agrees, the agent calls `authorize_subscription(paymentRequestId)` — that tool runs the VGS binding + intent + cryptogram flow.
4. The agent retries `publish_site` with the same HTML, and gets `status: published`.

The recurring mandate created on the VGS side has:
- `decline_threshold: { amount: 5, currency_code: "USD" }`
- `effective_until: now + 1 year`
- `quantity: 12` (twelve monthly charges)
- `preferred_merchant_name: "Vellum"`
- `merchant_category_code: 4816` (Computer Network Services)

After the first cryptogram, subsequent monthly charges can reuse the same intent without re-binding — the assurance is bound to the user's device for the life of the mandate.

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
- `authorize_subscription` is **always non-blocking** — when a browser step is needed, the tool returns `status: waiting_for_card` / `waiting_for_authentication` with the URL inside `content[]`. The agent surfaces the URL to the user, who opens it manually. After the user completes the step, the agent calls `authorize_subscription` again with the same `paymentRequestId` to advance.
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

The stdio variant auto-opens browser tabs at the right moments (Cmd+Click on macOS opens via `open <url>`). Point `AGENTIC_APP_BASE_URL` at your deployed site so the sites/subscriptions endpoints exist.

## Configuration

All optional, set in the MCP client's `env` block.

| Env var | Default | Description |
|---|---:|---|
| `AGENTIC_APP_BASE_URL` | `https://localhost:4200` | Browser URL for the React app and the public `/s/:id` endpoint. |
| `AGENTIC_API_BASE_URL` | `${AGENTIC_APP_BASE_URL}/api` | API base used by the MCP server. |
| `AGENTIC_BUYER_ID` | `demo-buyer` | Mock merchant buyer id. |
| `AGENTIC_CONSUMER_EMAIL` | `user@example.com` | Email used for token enrollment / OTP. |
| `AGENTIC_ENVIRONMENT` | `sandbox` | Passed through to the binding page. |
| `AGENTIC_OPEN_BROWSER` | `true` | Set `false` to return URLs without opening a browser. |
| `AGENTIC_BROWSER_APP` | auto | macOS app name for `open -a`. |
| `AGENTIC_BROWSER_WAIT_MS` | `300000` | Max wait time for browser sessions. |
| `AGENTIC_POLL_MS` | `1500` | Poll interval for browser sessions. |

## Smoke test

```bash
cd mcp-server
node scripts/smoke.js
```

Spawns a mock backend on an ephemeral port and round-trips `initialize` + `tools/list` + `publish_site` (expecting `payment_required`) over stdio.
