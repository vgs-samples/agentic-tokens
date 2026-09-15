import { deleteAgenticToken } from "../../server/token-deletion.js";
import { json, wrap } from "./_lib.js";

export default wrap(async (req) => {
  if (req.method !== "DELETE") return json(405, { error: "Method not allowed" });
  const url = new URL(req.url);
  const { status, data } = await deleteAgenticToken(
    url.searchParams.get("network"),
    url.searchParams.get("tokenId"),
  );
  return json(status, data);
});
