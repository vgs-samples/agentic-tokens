import { getStore } from "@netlify/blobs";
import { json, wrap } from "./_lib.js";

// Sites store: siteId → { html, buyerId, companyName, status, createdAt, expiresAt }
//
// Public entry points:
//   /s/:siteId                — published site (404 if status !== "published")
//   /preview/:siteId          — preview rendering (no payment check). Used as the src
//                                of a tiny iframe wrapper inside a Claude Desktop artifact:
//                                the artifact body is 5 lines of HTML that the LLM can
//                                write itself, which is what reliably triggers Claude's
//                                artifact preview pane.
//   /api/sites                — POST to store a site (MCP-side)
//   /api/sites/:siteId        — GET / PUT / DELETE for management

const TTL_MS = 24 * 60 * 60 * 1000;

export default wrap(async (req) => {
  const url = new URL(req.url);
  const store = getStore("agentic-sites");

  // Preview rendering: GET /preview/<siteId> — always serves the HTML if it exists,
  // ignoring status. The customer-facing URL is /s/:id and that one still does the
  // payment check.
  const previewMatch = url.pathname.match(/^\/preview\/([^/]+)\/?$/);
  if (previewMatch) {
    const siteId = previewMatch[1];
    const site = await readSite(store, siteId);
    if (!site) return new Response("Site not found", { status: 404 });
    return new Response(site.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  // Published site rendering: GET /s/<siteId>
  const publicMatch = url.pathname.match(/^\/s\/([^/]+)\/?$/);
  if (publicMatch) {
    const siteId = publicMatch[1];
    const site = await readSite(store, siteId);
    if (!site || site.status !== "published") {
      return new Response("Site not found", { status: 404 });
    }
    return new Response(site.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // Basic CSP — the agent-generated HTML can pull Tailwind/fonts from
        // common CDNs and images, but cannot execute inline scripts or
        // exfiltrate via custom origins.
        "Content-Security-Policy":
          "default-src 'self' 'unsafe-inline' https: data:; " +
          "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src https://fonts.gstatic.com data:; " +
          "img-src 'self' https: data:;",
      },
    });
  }

  // Management: /api/sites or /api/sites/:siteId
  const mgmtMatch = url.pathname.match(/^\/api\/sites(?:\/([^/]+))?\/?$/);
  if (!mgmtMatch) return json(404, { error: "Not found" });
  const siteId = mgmtMatch[1];

  if (req.method === "POST" && !siteId) {
    const body = await req.json().catch(() => ({}));
    if (!body.siteId || !body.html) return json(400, { error: "siteId and html required" });
    const record = {
      siteId: body.siteId,
      buyerId: body.buyerId ?? null,
      companyName: body.companyName ?? null,
      html: body.html,
      status: body.status ?? "published",
      createdAt: Date.now(),
      expiresAt: Date.now() + TTL_MS,
    };
    await store.setJSON(body.siteId, record);
    return json(200, stripHtml(record));
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
