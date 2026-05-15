# Agentic Tokens MCP Server

Local stdio MCP server that lets an AI agent shop against a mock sneaker catalog and create a VGS Agentic Tokens payment cryptogram through the existing demo app.

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

## Run

Start the demo app first:

```bash
cp .env.example .env
# Fill VGS_CLIENT_ID, VGS_CLIENT_SECRET, VGS_VAULT_ID, VGS_VAULT_ENV
docker compose up --build
```

Then configure your MCP client to run:

```bash
node /Users/flor/workspase/work/agentic-tokens/mcp-server/src/index.js
```

Useful environment variables:

| Variable | Default | Description |
|---|---:|---|
| `AGENTIC_APP_BASE_URL` | `https://localhost:4200` | Browser URL for the React app. |
| `AGENTIC_API_BASE_URL` | `${AGENTIC_APP_BASE_URL}/api` | API URL used by the MCP server. |
| `AGENTIC_BUYER_ID` | `demo-buyer` | Mock merchant buyer id. |
| `AGENTIC_CONSUMER_EMAIL` | `user@example.com` | Email used for token enrollment and OTP. |
| `AGENTIC_OPEN_BROWSER` | `true` | Set `false` to return URLs without opening a browser. |
| `AGENTIC_BROWSER_APP` | auto | macOS app name for `open -a`; by default, Chrome is used only when the system default browser is Firefox. |
| `AGENTIC_BROWSER_WAIT_MS` | `300000` | Max wait time for card/auth browser sessions. |

## Example Agent Prompt

```text
Find Nike sneakers under $150 and prepare the purchase for my approval.
```

After the agent proposes the item and the user approves:

```text
Approved, buy that product.
```

The agent should call `purchase_approved_product` with `approved=true`.
