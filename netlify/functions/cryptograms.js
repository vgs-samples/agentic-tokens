import { callVgs, config } from "../../server/vgs.js";
import { json, wrap } from "./_lib.js";

// POST /api/cryptograms — get payment cryptogram
export default wrap(async (req) => {
  const url = new URL(req.url);
  const tokenId = url.searchParams.get("tokenId");
  const intentId = url.searchParams.get("intentId");
  const body = await req.json().catch(() => undefined);
  const { status, data } = await callVgs(
    config.apiUrl, "POST",
    `/agentic-tokens/${tokenId}/intents/${intentId}/cryptograms`,
    body
  );
  return json(status, data);
});
