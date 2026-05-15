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
2. `propose_purchase` returns an approval handle, exact approval text, and an `existingCard` flag so the agent can ask the user whether to reuse a stored card.
3. After the user approves, `purchase_approved_product`:
   - reuses the buyer's stored card (or, with `useExistingCard: false`, forces fresh collection),
   - opens `/collect.html` if a card must be added,
   - enrolls the card as an agentic token,
   - opens `/binding.html` for Visa device binding / OTP / FIDO,
   - creates an intent,
   - requests a payment cryptogram.
4. `forget_card` removes the cached card mapping for a buyer so the next purchase prompts for fresh details.

The MCP server never receives raw PAN/CVV and never handles the Visa iframe directly. Those browser-only steps stay in the existing React app.

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

Verify with `/mcp` inside a Claude Code session — `agentic-tokens` should be listed with 4 tools.

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

Quit Claude Desktop completely (Cmd+Q) and reopen it. The tools icon in the chat composer should show "agentic-tokens — 4 tools".

### OpenAI Codex CLI

Edit `~/.codex/config.toml`:

```toml
[mcp_servers.agentic-tokens]
command = "node"
args = ["<REPO>/mcp-server/src/index.js"]
```

## Example session

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

On subsequent purchases the agent asks "use the card on file, or enter a new one?". To clear the cached card explicitly, say "forget my card" — the agent calls `forget_card`.

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
