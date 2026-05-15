import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["src/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, AGENTIC_OPEN_BROWSER: "false" },
  stdio: ["pipe", "pipe", "pipe"],
});

const messages = [];
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  for (const line of chunk.split("\n")) {
    if (line.trim()) messages.push(JSON.parse(line));
  }
});
child.stderr.pipe(process.stderr);

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
send({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: "search_products",
    arguments: { query: "nike sneakers under $150", brand: "Nike", maxPrice: 150 },
  },
});
send({
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: {
    name: "propose_purchase",
    arguments: { query: "nike sneakers under $150", brand: "Nike", maxPrice: 150 },
  },
});

setTimeout(() => {
  child.kill();
  const initialize = messages.find((message) => message.id === 1);
  const tools = messages.find((message) => message.id === 2);
  const search = messages.find((message) => message.id === 3);
  const proposal = messages.find((message) => message.id === 4);
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
}, 300);

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}
