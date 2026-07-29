import { callVgs, config } from "../../server/vgs.js";
import { json, requireTokenId, wrap } from "./_lib.js";

// /api/otp — the two OTP calls of the ID&V flow, split by whether the path carries a
// method identifier:
//   POST /api/otp/{identifier}?tokenId=  → deliver the code via that method
//   POST /api/otp?tokenId=               → verify the code the cardholder entered
// Netlify redirect placeholders don't substitute into the query string of the `to` target,
// so the identifier is read from the original request path (same as agentic-tokens.js).
export default wrap(async (req) => {
  const url = new URL(req.url);
  const tokenId = requireTokenId(url);
  if (req.method !== "POST") return json(405, { error: `Method ${req.method} not allowed` });

  const match = url.pathname.match(/\/api\/otp\/(.+)$/);
  const identifier = match?.[1];
  const body = await req.json();

  // Identifiers are opaque base64 — re-encode so "/" or "=" can't reshape the path.
  const path = identifier
    ? `/agentic-tokens/${tokenId}/otp/${encodeURIComponent(decodeURIComponent(identifier))}`
    : `/agentic-tokens/${tokenId}/otp`;

  const { status, data } = await callVgs(config.apiUrl, "POST", path, body);
  return json(status, data);
});
