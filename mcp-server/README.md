# Agentic Tokens MCP Server

Local stdio MCP server that lets an AI agent shop against a mock sneaker catalog and create a VGS Agentic Tokens payment cryptogram through the existing demo app.

## Prerequisites

1. **Demo app running.** The MCP server proxies VGS calls through the demo app's Node server.
   ```bash
   cp .env.example .env
   # Fill VGS_CLIENT_ID, VGS_CLIENT_SECRET, VGS_VAULT_ID, VGS_VAULT_ENV
   docker compose up --build
   ```
   The app must respond at https://localhost:4200.
2. **Node 22+** installed locally (the MCP server is a plain Node script).

## Flow

1. `search_products` searches the mock catalog.
2. `propose_purchase` returns an approval handle, the exact approval text, and `existingCards: [{cardId, lastFour, brand, label}]` so the agent can offer the user a choice of saved cards (or to add a new one).
3. After the user approves, `purchase_approved_product`:
   - uses the explicit `cardId` if the agent passes one (recommended when multiple cards are on file),
   - or, by default, reuses the most-recently-saved card,
   - or, with `useExistingCard: false`, opens `/collect.html` to capture a fresh card,
   - enrolls the chosen card as an agentic token,
   - opens `/binding.html` for Visa device binding / OTP / FIDO,
   - creates an intent,
   - requests a payment cryptogram.
4. `list_buyer_cards` returns the stored cards for a buyer (cardId + last-4 + brand). Use it any time outside the purchase flow.
5. `forget_card` removes one card (`cardId`) or all cards for a buyer.

The MCP server never receives raw PAN/CVV and never handles the Visa iframe directly. The merchant store only persists the opaque VGS `cardId` plus surface-display metadata (last-4, brand).

## Install in an MCP client

The MCP server runs from this repo. Replace `<REPO>` below with the absolute path to your checkout (e.g. `/Users/you/code/agentic-tokens`).

### Claude Code CLI

```bash
claude mcp add agentic-tokens node <REPO>/mcp-server/src/index.js
```

Or, to scope it to the project, create `.mcp.json` in the repo root:

```json
{
  "mcpServers": {
    "agentic-tokens": {
      "command": "node",
      "args": ["<REPO>/mcp-server/src/index.js"]
    }
  }
}
```

Verify with `/mcp` inside a Claude Code session — `agentic-tokens` should be listed with 5 tools.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentic-tokens": {
      "command": "node",
      "args": ["<REPO>/mcp-server/src/index.js"]
    }
  }
}
```

Quit Claude Desktop completely (Cmd+Q) and reopen it. The tools icon in the chat composer should show "agentic-tokens — 5 tools".

### OpenAI Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.agentic-tokens]
command = "node"
args = ["<REPO>/mcp-server/src/index.js"]
```

## Example session

First purchase (no cards on file):

```text
You: find me Nike sneakers under $150 and prepare the purchase for my approval.
Agent: [calls search_products and propose_purchase]
       Found Nike Pegasus 41 for $139.99 at Nike Store. Approve?
You:   yes
Agent: [calls purchase_approved_product, opens /collect.html in a browser tab]
       Please add a card in the browser tab I just opened.
You:   [fills the card form, the page confirms "Card saved"]
Agent: [opens /binding.html, runs Visa authentication]
       Please confirm in the Visa tab (TouchID or OTP 456789 in sandbox).
You:   [completes auth]
Agent: Cryptogram issued. intentId=..., cryptogramId=...
```

Later, with two saved cards:

```text
You: buy adidas Samba for me.
Agent: [propose_purchase returns existingCards: [••••1569, ••••1478]]
       Found adidas Samba OG for $100 at Mock Sneaker Shop. Approve?
       You have two cards on file: visa ••••1569 and visa ••••1478. Which one?
You:   the 1569 one.
Agent: [purchase_approved_product with cardId of the 1569 card → /binding → cryptogram]
```

To clear a stored card, say "forget the 1478 card" — the agent calls `forget_card` with the matching `cardId`.

## Pointing at a deployed backend

The MCP server is backend-agnostic — it only needs `AGENTIC_APP_BASE_URL` to point at any host that serves the same `/api/*` routes. The deployed Netlify build supports the full flow (including the MCP session bridge and the mock merchant store), backed by Netlify Blobs.

Run two MCP profiles side-by-side:

```json
{
  "mcpServers": {
    "agentic-tokens-local": {
      "command": "node",
      "args": ["<REPO>/mcp-server/src/index.js"]
    },
    "agentic-tokens-prod": {
      "command": "node",
      "args": ["<REPO>/mcp-server/src/index.js"],
      "env": { "AGENTIC_APP_BASE_URL": "https://your-deploy.netlify.app" }
    }
  }
}
```

Both expose the same 5 tools; the agent (or you) picks which to use.

## Configuration

All optional. Set in the MCP client's `env` block.

| Env var | Default | Description |
|---|---:|---|
| `AGENTIC_APP_BASE_URL` | `https://localhost:4200` | Browser URL for the React app. |
| `AGENTIC_API_BASE_URL` | `${AGENTIC_APP_BASE_URL}/api` | API base used by the MCP server. |
| `AGENTIC_BUYER_ID` | `demo-buyer` | Mock merchant buyer id. |
| `AGENTIC_CONSUMER_EMAIL` | `user@example.com` | Email used for token enrollment / OTP. |
| `AGENTIC_ENVIRONMENT` | `sandbox` | Passed through to the binding page (`sandbox` / `live` / `dev` / `local`). |
| `AGENTIC_OPEN_BROWSER` | `true` | Set `false` to return URLs without opening a browser. |
| `AGENTIC_BROWSER_APP` | auto | macOS app name for `open -a` (defaults to Chrome when Firefox is the system default). |
| `AGENTIC_BROWSER_WAIT_MS` | `300000` | Max wait time for browser sessions. |
| `AGENTIC_POLL_MS` | `1500` | Poll interval for browser sessions. |

Example with overrides:

```json
"agentic-tokens": {
  "command": "node",
  "args": ["<REPO>/mcp-server/src/index.js"],
  "env": {
    "AGENTIC_BUYER_ID": "test-buyer-2",
    "AGENTIC_BROWSER_APP": "Google Chrome"
  }
}
```

## Troubleshooting

- **Tools don't appear in the client.** Check the client's MCP log:
  - Claude Desktop: `~/Library/Logs/Claude/mcp-server-agentic-tokens.log`
  - Claude Code: `claude mcp list` and `claude mcp get agentic-tokens`
- **TLS errors when MCP calls the API.** The server auto-sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for localhost. If `AGENTIC_APP_BASE_URL` points at a non-local host, set it explicitly in `env`.
- **Browser doesn't open.** Set `AGENTIC_BROWSER_APP: "Google Chrome"` or set `AGENTIC_OPEN_BROWSER: "false"` and follow the URLs printed in the tool's text response manually.
- **Stuck waiting for browser action.** Default timeout is 5 minutes (`AGENTIC_BROWSER_WAIT_MS`). The agent can also call `purchase_approved_product` with `waitForBrowser: false` to return immediately and resume the same `purchaseId` later.
- **Sandbox OTP.** In `/binding.html`, OTP code `456789` is always accepted.

## Smoke test

```bash
cd mcp-server
node scripts/smoke.js
```

Round-trips `initialize` + `tools/list` + `search_products` + `propose_purchase` over stdio. Useful for verifying the server boots without an MCP client.
