# VGS Marketing Agency — MCP Server

Quick-start demo of a fictional startup: an AI agent can spin up a marketing landing page for the user, the agency charges $5/month to host it, and the subscription is authorized via VGS Agentic Tokens (TouchID-bound intent + network cryptogram).

The MCP server exposes the agency's product surface; the React app on the same site renders the hosted pages and handles the device-binding step.

## What's in the box

- **`create_marketing_site(brief, companyName, …)`** — generates a real HTML landing page from a brief, stores it as a draft.
- **`deploy_site(siteId)`** — publishes the page so it becomes reachable at `/s/<siteId>`. If the buyer has no active subscription, returns `status: payment_required` with a `paymentRequestId`.
- **`authorize_subscription(paymentRequestId)`** — triggers the existing VGS device-binding flow (opens `/binding.html` for TouchID / FIDO / OTP) and creates a recurring intent + cryptogram. Marks the buyer as having an active subscription for 30 days.
- **`list_subscriptions(buyerId?)`** / **`cancel_subscription(buyerId?)`** — read/cancel.
- **`list_buyer_cards(buyerId?)`** / **`forget_card(buyerId?, cardId?)`** — same card management as the underlying VGS demo.

Built on `@modelcontextprotocol/sdk@^1.29`. Two transports ship together:

- **stdio** — `node mcp-server/src/index.js`, auto-opens browser tabs for collect / binding. Best for desktop MCP clients.
- **HTTP** — deployed at `https://<your-site>/mcp` via `netlify/functions/mcp.js`, stateless, non-blocking. The agent surfaces collect / binding URLs back to the user instead.

## Demo script

```text
You: Сделай мне сайт для маркетингового агентства "Acme Marketing",
     минимальный, с hero-секцией и CTA.

Agent: [create_marketing_site] → siteId=ax9k2, draft
       ✓ Generated. Preview: https://vgs-agentic-tokens.netlify.app/s/ax9k2

       [deploy_site(ax9k2)] → payment_required: $5/month
       VGS Marketing Agency charges $5/month to host this site. Authorize?

You:  yes

Agent: [authorize_subscription(prXYZ)] → waiting_for_authentication
       Open the binding URL and complete TouchID:
       https://vgs-agentic-tokens.netlify.app/binding.html?…

You:  [opens, completes TouchID, comes back] "done"

Agent: [authorize_subscription(prXYZ) — resume] → status: completed
       ✅ Subscription active until 2026-06-20.

       [deploy_site(ax9k2) — retry] → status: published
       🚀 Live: https://vgs-agentic-tokens.netlify.app/s/ax9k2
```

The user clicks the live URL, sees a real marketing page hosted on the same Netlify site.

## How "the agent auto-proposes payment" actually works

It's the **402 pattern over MCP**, not prompt engineering:

1. `deploy_site` returns `{ status: "payment_required", amount, currency, paymentRequestId, description, nextStep }`.
2. Any decent LLM (Claude 3.5+, GPT-4o+) reads `nextStep` and surfaces the question to the user before calling any other tool.
3. After the user agrees, the agent calls `authorize_subscription(paymentRequestId)` — that tool runs the VGS binding + intent + cryptogram flow.
4. The agent retries `deploy_site` and gets `status: published` this time.

The recurring mandate created on the VGS side has:
- `decline_threshold: { amount: 5, currency_code: "USD" }`
- `effective_until: now + 1 year`
- `quantity: 12` (twelve monthly charges)
- `preferred_merchant_name: "VGS Marketing Agency"`
- `merchant_category_code: 4816` (Computer Network Services)

After the first cryptogram, subsequent monthly charges can reuse the same intent without re-binding — the assurance is bound to the user's device for the life of the mandate.

## Install in an MCP client

### HTTP — deployed MCP

```json
{
  "mcpServers": {
    "vgs-marketing-agency": {
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
    "vgs-marketing-agency": {
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

You should get back `serverInfo.name = "vgs-marketing-agency"`.

### stdio — local install

```bash
claude mcp add vgs-marketing-agency node /absolute/path/to/agentic-tokens/mcp-server/src/index.js
```

Or via `.mcp.json`:

```json
{
  "mcpServers": {
    "vgs-marketing-agency": {
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

Spawns a mock backend on an ephemeral port and round-trips `initialize` + `tools/list` + `create_marketing_site` + `deploy_site` (expecting `payment_required`) over stdio.
