import { callVgs, config } from "../../server/vgs.js";
import { json, requireTokenId, wrap } from "./_lib.js";

// POST /api/agentic-enrollments?tokenId= — finish enrolling the token after cardholder
// verification (ID&V flow only; the passkey flow enrolls at token creation).
export default wrap(async (req) => {
  const tokenId = requireTokenId(new URL(req.url));

  const body = await req.json();
  const { status, data } = await callVgs(
    config.apiUrl, "POST",
    `/agentic-tokens/${tokenId}/agentic-enrollments`,
    body
  );
  return json(status, data);
});
