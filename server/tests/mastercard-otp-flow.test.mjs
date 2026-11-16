import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrollmentOtpContext, getStepUpOptions, requestOtp, submitOtp, readOtpDelivery, readOtpVerification } from "../../client-react/src/idv.ts";

// Real demo HTTP routes plus frontend builders/parsers; only Maranui is simulated.
// All URLs and credentials are local test fixtures.
test("Visa and Mastercard ID&V through Express and Netlify: enrollment reference, lookup and OTP", async (t) => {
  const calls = [];
  const scenarios = [
    { network: "mastercard", token: "synthetic-mastercard-token", card: "synthetic-mastercard-card",
      originalRef: `vgs:ms:lookup:v1:${"encoded-enrollment-context".repeat(15)}` },
    { network: "visa", token: "synthetic-visa-token", card: "synthetic-visa-card",
      originalRef: "ea419845-d22c-448f-a18d-558b7467b600" },
  ];
  let verificationRef;
  let revision = 0;
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/auth") return res.end(JSON.stringify({ access_token: "test-only", expires_in: 300 }));
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ path: req.url, method: req.method, body });
    const scenario = scenarios.find(({ card, token }) => req.url.includes(card) || req.url.includes(token));
    assert.ok(scenario, "Unknown test card or token");
    const { token, card, originalRef, network } = scenario;
    const mastercard = network === "mastercard";
    const attrs = body?.data?.attributes;
    const root = `/agentic-tokens/${token}`;
    const reply = (type, id, attributes) => res.end(JSON.stringify({ data: { id, type, attributes } }));
    if (req.url === `/cards/${card}/agentic-tokens`) {
      assert.equal(req.method, "POST");
      assert.equal(attrs.mc_enable_otp, mastercard ? true : undefined);
      res.statusCode = 201;
      return reply("agentic_tokens", token, { cardholder_verification: "otp", client_ref_id: originalRef });
    }
    if (req.url.startsWith(`${root}/step-up-options?`)) {
      assert.equal(req.method, "GET");
      assert.equal(new URL(req.url, "http://test").searchParams.get("client_ref_id"), originalRef);
      return reply("device_attestations", token, { status: "CHALLENGE", passkey_required: false, stepUpRequest: [
        { method: "OTPSMS", identifier: `${network}/sms/protected==`, value: "***2671" },
        { method: "OTPEMAIL", identifier: `${network}/email/protected==`, value: "b***@example.test" },
      ] });
    }
    if (req.url.startsWith(`${root}/otp/`)) {
      assert.equal(attrs.client_ref_id, originalRef, "Delivery and resend must use the lookup reference");
      assert.equal(body.data.type, "otp_methods");
      verificationRef = mastercard ? `vgs:ms:v1:session-${++revision}` : originalRef;
      const identifier = decodeURIComponent(req.url.slice(`${root}/otp/`.length));
      return reply("otp_methods", identifier, { method: "SMS", client_ref_id: verificationRef });
    }
    if (req.url === `${root}/otp`) {
      assert.equal(attrs.client_ref_id, verificationRef, "Verification must use the newest session reference");
      assert.equal(body.data.type, "otp_submissions");
      if (attrs.otp === "000000") {
        res.statusCode = 409;
        return res.end(JSON.stringify({ error: "mastercard_upstream_error", detail: "Verification failed" }));
      }
      if (attrs.otp === "111111") {
        verificationRef = mastercard ? `vgs:ms:v1:session-${++revision}` : originalRef;
        return reply("otp_submissions", token, { status: "PENDING", client_ref_id: verificationRef });
      }
      assert.equal(attrs.otp, "012345");
      return reply("otp_submissions", token, { status: "VALIDATED", authenticationContext: null });
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Unexpected upstream route" }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  const env = { ...process.env, VGS_API_URL: origin, VGS_AUTH_URL: `${origin}/auth`, VGS_CMP_API_URL: origin,
    VGS_CLIENT_ID: "test-only", VGS_CLIENT_SECRET: "test-only", VGS_VAULT_ENV: "sandbox", PORT: "0" };
  const cwd = await mkdtemp(join(tmpdir(), "mastercard-otp-proxy-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const bootstrap = `import net from 'node:net';
    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function (...args) {
      this.once('listening', () => console.log('TEST_PORT=' + this.address().port));
      return listen.apply(this, args);
    };
    await import(${JSON.stringify(new URL("../server.js", import.meta.url).href)});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", bootstrap], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, "exit"); } });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Demo server did not start")), 10000);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/TEST_PORT=(\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.once("error", (err) => { clearTimeout(timeout); reject(err); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Demo server exited: ${code}`)); });
  });
  Object.assign(process.env, env);
  const handlers = Object.fromEntries(await Promise.all(["step-up-options", "otp", "agentic-tokens"]
    .map(async (name) => [name, (await import(`../../netlify/functions/${name}.js`)).default])));
  const nativeFetch = globalThis.fetch;
  for (const adapter of ["Express", "Netlify"]) {
    for (const { network, token, card, originalRef } of scenarios) {
      for (const method of ["OTPSMS", "OTPEMAIL"]) {
        await t.test(`${adapter} ${network} ${method}`, async (t) => {
          t.mock.method(globalThis, "fetch", (url, options) => {
            if (typeof url !== "string" || !url.startsWith("/api/")) return nativeFetch(url, options);
            if (adapter === "Express") return nativeFetch(`http://127.0.0.1:${port}${url}`, options);
            const handler = url.startsWith("/api/cards/") ? handlers["agentic-tokens"]
              : url.startsWith("/api/step-up-options") ? handlers["step-up-options"] : handlers.otp;
            return handler(new Request(`http://demo.test${url}`, options));
          });
          const before = calls.length;
          const enrolled = await fetch(`/api/cards/${card}/agentic-tokens`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: { type: "agentic_tokens", attributes: {
              consumer_email: "buyer@example.test", ...(network === "mastercard" ? { mc_enable_otp: true } : {}),
            } } }),
          });
          assert.equal(enrolled.status, 201);
          const context = enrollmentOtpContext(await enrolled.json(), network);
          assert.equal(context.clientRefId, originalRef);
          const options = await getStepUpOptions(token, context.clientRefId);
          const selected = options.methods.find((item) => item.method === method);
          const delivery = await requestOtp(token, originalRef, selected.identifier);
          let reference = readOtpDelivery(delivery, selected.identifier, originalRef);
          await assert.rejects(submitOtp(token, reference, "buyer@example.test", "000000"));
          const pending = readOtpVerification(await submitOtp(token, reference, "buyer@example.test", "111111"), token, reference);
          assert.equal(pending.status, "pending");
          reference = pending.clientRefId;
          assert.equal(readOtpVerification(await submitOtp(token, reference, "buyer@example.test", "012345"), token, reference).status, "verified");
          const resend = await requestOtp(token, originalRef, selected.identifier);
          const resendReference = readOtpDelivery(resend, selected.identifier, originalRef);
          if (network === "mastercard") assert.notEqual(resendReference, reference);
          else assert.equal(resendReference, originalRef);
          assert.equal(calls.length - before, 7, "No implicit retries or duplicate sends");
        });
      }
    }
  }
});
