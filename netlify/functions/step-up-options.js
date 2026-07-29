import { callVgs, config } from "../../server/vgs.js";
import { json, requireTokenId, wrap } from "./_lib.js";

// GET /api/step-up-options?tokenId=&clientRefId= — cardholder verification options for the
// ID&V flow (passkey-exempt vaults). Mirrors the Express route. client_ref_id is required by
// the API and must be URL-safe (letters, digits, . _ : -).
export default wrap(async (req) => {
  const url = new URL(req.url);
  const tokenId = requireTokenId(url);

  const query = new URLSearchParams({ client_ref_id: url.searchParams.get("clientRefId") ?? "" });

  const { status, data } = await callVgs(
    config.apiUrl, "GET",
    `/agentic-tokens/${tokenId}/step-up-options?${query}`
  );
  return json(status, data);
});
