import { callVgs, config } from "../../server/vgs.js";
import { json, wrap } from "./_lib.js";

// POST /api/confirmations — confirm transaction outcome
export default wrap(async (req) => {
  const url = new URL(req.url);
  const tokenId = url.searchParams.get("tokenId");
  const intentId = url.searchParams.get("intentId");
  const body = await req.json().catch(() => undefined);
  const { status, data } = await callVgs(
    config.apiUrl, "POST",
    `/agentic-tokens/${tokenId}/intents/${intentId}/confirmations`,
    body
  );
  return json(status, data);
});
