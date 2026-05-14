import { callVgs, config } from "../../server/vgs.js";
import { json, wrap } from "./_lib.js";

// POST /api/cards/:cardId/agentic-tokens — enroll card
// Redirect in netlify.toml passes cardId as query param.
export default wrap(async (req) => {
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  const body = await req.json();
  const { status, data } = await callVgs(
    config.apiUrl, "POST",
    `/cards/${cardId}/agentic-tokens`,
    body
  );
  return json(status, data);
});
