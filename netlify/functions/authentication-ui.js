import { prepareAuthenticationUi } from "../../server/otp.js";
import { json, wrap } from "./_lib.js";

export default wrap(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  let body;
  try { body = await req.json(); }
  catch { return json(400, { error: "Invalid JSON request" }); }
  const { status, data } = await prepareAuthenticationUi(new URL(req.url).searchParams.get("tokenId"), body);
  return json(status, data);
});
