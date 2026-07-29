import { callVgs, config } from "../../server/vgs.js";
import { json, wrap } from "./_lib.js";

// POST /api/cryptograms — get payment cryptogram
// Network-specific endpoints behind one route:
//   Visa       — intent-scoped: /agentic-tokens/{tokenId}/intents/{intentId}/cryptograms
//   Mastercard — card-scoped SCOF checkout (no intent): /cards/{cardId}/agentic-tokens/{tokenId}/cryptograms
//   Amex       — card-scoped ACE payment credentials (no intent): /cards/{cardId}/agentic-tokens/{tokenId}/cryptograms
// The caller selects by passing intentId (Visa) or cardId (card-scoped networks).
export default wrap(async (req) => {
  const url = new URL(req.url);
  const tokenId = url.searchParams.get("tokenId");
  const intentId = url.searchParams.get("intentId");
  const cardId = url.searchParams.get("cardId");
  const body = await req.json().catch(() => undefined);
  const path = cardId
    ? `/cards/${cardId}/agentic-tokens/${tokenId}/cryptograms`
    : `/agentic-tokens/${tokenId}/intents/${intentId}/cryptograms`;
  const { status, data } = await callVgs(config.apiUrl, "POST", path, body);
  return json(status, data);
});
