import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["src/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, AGENTIC_OPEN_BROWSER: "false" },
  stdio: ["pipe", "pipe", "pipe"],
});

const messages = [];
let buffer = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop();
  for (const line of lines) {
    if (line.trim()) messages.push(JSON.parse(line));
  }
});
child.stderr.pipe(process.stderr);

send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1.0" } },
});

await waitFor(() => messages.find((m) => m.id === 1), 2000);

send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
send({
  jsonrpc: "2.0", id: 3, method: "tools/call",
  params: { name: "search_products", arguments: { query: "nike sneakers under $150", brand: "Nike", maxPrice: 150 } },
});
send({
  jsonrpc: "2.0", id: 4, method: "tools/call",
  params: { name: "propose_purchase", arguments: { query: "nike sneakers under $150", brand: "Nike", maxPrice: 150 } },
});

await waitFor(() => messages.find((m) => m.id === 4), 3000);
child.kill();

const initialize = messages.find((m) => m.id === 1);
const tools = messages.find((m) => m.id === 2);
const search = messages.find((m) => m.id === 3);
const proposal = messages.find((m) => m.id === 4);

if (
  !initialize?.result?.serverInfo
  || !tools?.result?.tools?.length
  || !search?.result?.structuredContent?.products?.length
  || !proposal?.result?.structuredContent?.purchaseId
) {
  console.error(JSON.stringify(messages, null, 2));
  process.exit(1);
}
console.log("MCP smoke test passed");

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for response");
}
