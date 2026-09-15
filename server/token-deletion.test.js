import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteAgenticToken } from "./token-deletion.js";
import deletionHandler from "../netlify/functions/token-deletion.js";

test("token deletion proxies the shared contract and rejects invalid requests", async (t) => {
  const requests = [];
  let upstreamStatus = 200;
  let upstreamBody = {
    data: { id: "enr-123", type: "card_deletion", attributes: { status: "deleted", src_correlation_id: "corr" } },
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (options.method === "POST") {
      return Response.json({ access_token: "test-only", expires_in: 3600 });
    }
    requests.push({ url: String(url), ...options });
    return Response.json(upstreamBody, { status: upstreamStatus });
  });

  for (const network of ["amex", "mastercard"]) {
    const result = await deleteAgenticToken(network, "  enr/123?x=1  ");
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, upstreamBody);
    const request = requests.at(-1);
    assert.equal(new URL(request.url).pathname, `/temporary/${network}/agentic-tokens/enr%2F123%3Fx%3D1`);
    assert.equal(request.method, "DELETE");
    assert.equal(request.body, undefined);
  }

  upstreamStatus = 502;
  upstreamBody = { error: "amex_upstream_error", detail: "Enrollment not found" };
  const response = await deletionHandler(new Request("https://demo.test/api/token-deletion?network=amex&tokenId=enr-123", {
    method: "DELETE",
  }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), upstreamBody);

  const count = requests.length;
  for (const [network, tokenId] of [["visa", "id"], [null, "id"], ["amex", ""], ["amex", "   "], ["amex", ["id"]]]) {
    assert.equal((await deleteAgenticToken(network, tokenId)).status, 400);
  }
  const wrongMethod = await deletionHandler(new Request("https://demo.test/api/token-deletion?network=amex&tokenId=id"));
  assert.equal(wrongMethod.status, 405);
  assert.equal(requests.length, count);
});
