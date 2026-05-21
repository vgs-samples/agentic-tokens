import { getStore } from "@netlify/blobs";
import { json, wrap } from "./_lib.js";

// Sites store: siteId → { html, buyerId, companyName, status, createdAt, expiresAt }
//
// Two public entry points share this function:
//   /s/:siteId                — public HTML rendering (served to the world)
//   /api/sites and /api/sites/:siteId — MCP-side CRUD

const TTL_MS = 24 * 60 * 60 * 1000;

export default wrap(async (req) => {
  const url = new URL(req.url);
  const store = getStore("agentic-sites");

  // Public rendering: GET /s/<siteId>
  const publicMatch = url.pathname.match(/^\/s\/([^/]+)\/?$/);
  if (publicMatch) {
    const siteId = publicMatch[1];
    const site = await readSite(store, siteId);
    if (!site) return new Response("Site not found", { status: 404 });
    if (site.status !== "published") {
      return new Response(paymentRequiredHtml(site), {
        status: 402,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response(site.html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // Management: /api/sites or /api/sites/:siteId
  const mgmtMatch = url.pathname.match(/^\/api\/sites(?:\/([^/]+))?\/?$/);
  if (!mgmtMatch) return json(404, { error: "Not found" });
  const siteId = mgmtMatch[1];

  if (req.method === "POST" && !siteId) {
    const body = await req.json().catch(() => ({}));
    if (!body.siteId || !body.html) return json(400, { error: "siteId and html required" });
    const expiresAt = Date.now() + TTL_MS;
    const record = {
      siteId: body.siteId,
      buyerId: body.buyerId ?? null,
      companyName: body.companyName ?? null,
      brief: body.brief ?? null,
      html: body.html,
      status: body.status ?? "draft",
      createdAt: Date.now(),
      expiresAt,
    };
    await store.setJSON(body.siteId, record);

    // One-site-per-buyer cleanup: drop any previous site this buyer owned.
    if (body.buyerId) {
      const ownerKey = `__owner__/${body.buyerId}`;
      const previous = await store.get(ownerKey, { type: "json" });
      if (previous?.siteId && previous.siteId !== body.siteId) {
        await store.delete(previous.siteId);
      }
      await store.setJSON(ownerKey, { siteId: body.siteId });
    }
    return json(200, { ...stripHtml(record) });
  }

  if (req.method === "GET" && siteId) {
    const site = await readSite(store, siteId);
    if (!site) return json(404, { error: "Site not found" });
    return json(200, site); // includes html for MCP-side preview
  }

  if (req.method === "PUT" && siteId) {
    const body = await req.json().catch(() => ({}));
    const site = await readSite(store, siteId);
    if (!site) return json(404, { error: "Site not found" });
    const next = { ...site, ...body, siteId, updatedAt: Date.now() };
    await store.setJSON(siteId, next);
    return json(200, stripHtml(next));
  }

  if (req.method === "DELETE" && siteId) {
    await store.delete(siteId);
    return json(200, { siteId, deleted: true });
  }

  return json(405, { error: `Method ${req.method} not allowed` });
});

async function readSite(store, siteId) {
  const value = await store.get(siteId, { type: "json" });
  if (!value) return null;
  if (value.expiresAt && Date.now() > value.expiresAt) {
    await store.delete(siteId);
    return null;
  }
  return value;
}

function stripHtml(record) {
  const { html, ...rest } = record;
  return { ...rest, hasHtml: Boolean(html) };
}

function paymentRequiredHtml(site) {
  const name = (site.companyName || "this site").replace(/</g, "&lt;");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Payment required</title>
<style>
  body { font: 16px/1.5 system-ui; max-width: 540px; margin: 80px auto; padding: 0 20px; color: #1f2937; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #fef3c7; color: #92400e; font-size: 12px; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
</style></head>
<body>
  <span class="badge">402 Payment Required</span>
  <h1 style="margin-top: 8px;">Almost there.</h1>
  <p>${name} is generated but not yet published.</p>
  <p>VGS Marketing Agency requires an active <strong>$5/month hosting subscription</strong> to make this site live.</p>
  <p style="color: #6b7280; font-size: 14px;">Site id: <code>${site.siteId}</code></p>
</body></html>`;
}
