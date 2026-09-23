import { callVgs, config } from "../../server/vgs.js";
import { json, wrap } from "./_lib.js";

// DELETE /api/amex-enrollments?enrollmentId= — no request body.
export default wrap(async (req) => {
  if (req.method !== "DELETE") return json(405, { error: `Method ${req.method} not allowed` });
  const enrollmentId = new URL(req.url).searchParams.get("enrollmentId")?.trim();
  if (!enrollmentId) return json(400, { error: "enrollmentId required" });
  const { status, data } = await callVgs(
    config.apiUrl, "DELETE",
    `/agentic-tokens/${encodeURIComponent(enrollmentId)}`
  );
  return json(status, data);
});
