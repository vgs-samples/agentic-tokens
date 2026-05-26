#!/usr/bin/env node
// stdio entry point — runs locally and talks to a backend over /api/*.
// Desktop and Codex CLI clients can auto-open browser handoffs. Codex CLI mode
// still returns payment/browser-flow URLs immediately so the user can complete
// them manually and the agent can resume later without holding a tool call open.

import { spawn, spawnSync } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, InMemoryRequestStore } from "./server.js";

const DEFAULT_APP_BASE_URL = "https://localhost:4200";

const clientMode = (process.env.AGENTIC_CLIENT_MODE || "").toLowerCase();
const codexCliMode = ["codex", "codex-cli", "codex_cli"].includes(clientMode)
  || process.env.CODEX_CLI === "true";
const appBaseUrl = normalizeBaseUrl(process.env.AGENTIC_APP_BASE_URL || DEFAULT_APP_BASE_URL);
const apiBaseUrl = normalizeBaseUrl(process.env.AGENTIC_API_BASE_URL || `${appBaseUrl}/api`);
const openBrowserEnabled = process.env.AGENTIC_OPEN_BROWSER === undefined
  ? true
  : process.env.AGENTIC_OPEN_BROWSER !== "false";
const openPreviewEnabled = process.env.AGENTIC_OPEN_PREVIEW === undefined
  ? true
  : process.env.AGENTIC_OPEN_PREVIEW !== "false";
const waitForBrowser = process.env.AGENTIC_WAIT_FOR_BROWSER === undefined
  ? !codexCliMode
  : process.env.AGENTIC_WAIT_FOR_BROWSER !== "false";
const browserApp = process.env.AGENTIC_BROWSER_APP || defaultBrowserOverride();

if (/^https:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(appBaseUrl)) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= "0";
}

const server = createMcpServer({
  apiBaseUrl,
  appBaseUrl,
  requestStore: new InMemoryRequestStore(),
  openBrowser: (url) => openUrl(url, openBrowserEnabled),
  openPreview: (url) => openUrl(url, openPreviewEnabled),
  buyerId: process.env.AGENTIC_BUYER_ID,
  consumerEmail: process.env.AGENTIC_CONSUMER_EMAIL,
  environment: process.env.AGENTIC_ENVIRONMENT,
  waitForBrowser,
  waitMs: parseInt(process.env.AGENTIC_BROWSER_WAIT_MS, 10) || undefined,
  pollMs: parseInt(process.env.AGENTIC_POLL_MS, 10) || undefined,
  // Stdio mode defaults to local preview. Render writes HTML to /tmp and opens
  // it when AGENTIC_OPEN_PREVIEW is enabled. Set
  // AGENTIC_LOCAL_PREVIEW=false to fall back to the HTTP-style behavior
  // (store on the backend, return previewUrl).
  localPreview: process.env.AGENTIC_LOCAL_PREVIEW !== "false",
  clientMode: codexCliMode ? "codex-cli" : (clientMode || "desktop"),
});

await server.connect(new StdioServerTransport());

function openUrl(url, enabled) {
  if (!enabled) return false;
  const platform = process.platform;
  let command;
  let args;
  if (platform === "darwin") {
    command = "open";
    args = browserApp ? ["-a", browserApp, url] : [url];
  } else if (platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch (err) {
    process.stderr.write(`[agentic-tokens-mcp] Could not open browser: ${err.message}\n`);
    return false;
  }
}

function defaultBrowserOverride() {
  if (process.platform !== "darwin") return "";
  return isDefaultBrowserFirefox() ? "Google Chrome" : "";
}

function isDefaultBrowserFirefox() {
  try {
    const result = spawnSync(
      "defaults",
      ["read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    if (result.status !== 0 || !result.stdout) return false;
    return result.stdout.split(/\n\s{4}\},/).some((handler) => {
      const isBrowserHandler =
        /LSHandlerContentType\s*=\s*"?com\.apple\.default-app\.web-browser"?;/.test(handler)
        || /LSHandlerURLScheme\s*=\s*"?https?"?;/.test(handler);
      const isFirefox =
        /LSHandlerRole(?:All|Viewer)\s*=\s*"[^"]*firefox[^"]*";/i.test(handler);
      return isBrowserHandler && isFirefox;
    });
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}
