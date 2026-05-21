// Remote MCP endpoint — Streamable HTTP transport in stateless mode.
//
// Each request is a fresh function invocation, so we cannot keep mid-flow
// authorization state in process memory. We persist it in Netlify Blobs and
// pin the MCP server to non-blocking mode (the agent re-invokes the tool to
// advance state instead of holding open a 5-minute browser wait).

import { getStore } from "@netlify/blobs";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../../mcp-server/src/server.js";

const REQUEST_TTL_MS = 30 * 60 * 1000;

class BlobsRequestStore {
  constructor() {
    this.store = getStore("agentic-mcp-flow-state");
  }
  async get(id) {
    const value = await this.store.get(id, { type: "json" });
    if (!value) return null;
    if (value.expiresAt && Date.now() > value.expiresAt) {
      await this.store.delete(id);
      return null;
    }
    return value;
  }
  async set(id, value) {
    await this.store.setJSON(id, { ...value, expiresAt: Date.now() + REQUEST_TTL_MS });
  }
  async delete(id) {
    await this.store.delete(id);
  }
}

export default async (req) => {
  const url = new URL(req.url);
  // Same-origin: the function runs on the deployed site, so /api/* lives at the same host.
  const apiBaseUrl = `${url.origin}/api`;
  const appBaseUrl = url.origin;

  const server = createMcpServer({
    apiBaseUrl,
    appBaseUrl,
    requestStore: new BlobsRequestStore(),
    openBrowser: () => false, // no display on the server; agent surfaces the URL
    waitForBrowser: false,    // serverless can't wait minutes — the agent polls by re-calling
  });

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,   // stateless: no MCP session header, no in-memory session map
    enableJsonResponse: true,        // JSON response instead of SSE (Netlify Functions are request/response)
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(req);
  } finally {
    await transport.close();
    await server.close();
  }
};
