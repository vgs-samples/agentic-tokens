import { callVgs, config } from "../../server/vgs.js";
import { json, wrap } from "./_lib.js";

// POST /api/cards/:cardId/agentic-tokens — enroll card.
// Netlify redirect placeholders don't substitute into the query string of
// the `to` target, so we read cardId from the original request path.
export default wrap(async (req) => {
  const url = new URL(req.url);
  const match = url.pathname.match(/\/cards\/([^/]+)\/agentic-tokens/);
  const cardId = match?.[1];
  if (!cardId) return json(400, { error: "cardId missing in path" });

  const body = await req.json();
  const { status, data } = await callVgs(
    config.apiUrl, "POST",
    `/cards/${cardId}/agentic-tokens`,
    body
  );
  return json(status, data);
});
