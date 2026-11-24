import assert from "node:assert/strict";
import { test } from "node:test";

const { VgsAgenticAuth, VgsAgenticAuthError } = await import(
  process.env.VGS_AGENTIC_SDK_URL || "../src/vgs-agentic-auth.js"
);
const origin = "https://checkout.example";
const mcOrigin = "https://sandbox.src.mastercard.com";
const visaOrigin = "https://sbx.vts.auth.visa.com";
const method = { method: "3DS", identifier: "vgs:ms:v1:browser-method" };
const assurance = { verificationData: [{ verificationType: "CARDHOLDER", verificationEntity: "03",
  verificationMethod: "01", verificationResults: "01", additionalData: "provider-proof" }] };
const prepared = {
  launch_uri: `${mcOrigin}/auth?origin=${encodeURIComponent(origin)}`,
  authentication_payload: { srcCorrelationId: "lookup-id", traceId: "latest-affinity",
    accountReference: { srcDigitalCardId: "card-token" },
    authenticationMethod: { authenticationMethodType: "3DS", authenticationSubject: "CARDHOLDER" } },
};
const mcSuccess = { srcCorrelationId: "lookup-id", traceId: "latest-affinity", assuranceData: assurance,
  authenticationStatus: "COMPLETE", authenticationResult: "AUTHENTICATED" };
const envelope = () => ({ data: { id: method.identifier, type: "otp_methods",
  attributes: { method: "3DS", authenticationContext: prepared } } });
const flush = () => new Promise((resolve) => setImmediate(resolve));

function surface(t, { blocked = false, ready = true, authenticate = true } = {}) {
  const listeners = new Set();
  const timers = new Map();
  const opened = [];
  const commands = [];
  const frames = [];
  let timerId = 0;
  const emit = (data, eventOrigin = mcOrigin, source = popup) => {
    for (const listener of [...listeners]) listener({ data, origin: eventOrigin, source });
  };
  const popup = { closed: false, location: { replace: (url) => opened.push(url) },
    close() { this.closed = true; }, postMessage: (...args) => commands.push(args) };
  const host = { location: { origin },
    open: (...args) => { opened.push(args); return blocked ? null : popup; },
    addEventListener: (_type, fn) => listeners.add(fn), removeEventListener: (_type, fn) => listeners.delete(fn),
    setInterval: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearInterval: (id) => timers.delete(id),
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id),
  };
  const container = { appendChild(frame) {
    frames.push(frame);
    if (ready) queueMicrotask(() => emit({ type: "AUTH_READY", requestID: "visa-request" }, visaOrigin, frame.contentWindow));
  } };
  const doc = { body: container, createElement(tag) {
    assert.equal(tag, "iframe");
    const frame = { style: {}, removed: false, remove() { this.removed = true; }, contentWindow: {
      postMessage(command, target) {
        commands.push([command, target]);
        assert.equal(target, visaOrigin);
        if (command.type === "CREATE_AUTH_SESSION") queueMicrotask(() => emit({ type: "AUTH_SESSION_CREATED",
          sessionContext: { sessionId: "visa-session" }, browserData: { browserHeader: "provider-browser-data" },
          dfpSessionID: "device-fingerprint" }, visaOrigin, frame.contentWindow));
        if (command.type === "AUTHENTICATE" && authenticate) queueMicrotask(() => {
          emit({ type: "AUTH_COMPLETE", assuranceData: { fidoBlob: "forged" } }, "https://evil.example", frame.contentWindow);
          emit({ type: "AUTH_COMPLETE", assuranceData: { fidoBlob: "forged" } }, visaOrigin, {});
          emit({ type: "AUTH_COMPLETE", assuranceData: { identifier: "visa-credential", fidoBlob: "visa-proof" } },
            visaOrigin, frame.contentWindow);
        });
      },
    } };
    return frame;
  } };
  for (const [name, value] of [["window", host], ["document", doc]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  return { opened, commands, popup, frames, listeners, timers, emit, container };
}

function mcFlow(request) {
  return new VgsAgenticAuth({ tokenId: "card-token", environment: "sandbox",
    clientRefId: "vgs:ms:lookup:v1:enrollment-context", request });
}
function visaFlow(request) {
  return new VgsAgenticAuth({ tokenId: "visa-token", environment: "sandbox", consumerEmail: "buyer@example.test",
    clientRefId: "visa-enrollment-reference", timeout: 500, request });
}

test("verify opens Mastercard synchronously and owns preparation, protocol and proof extraction", async (t) => {
  const b = surface(t);
  const calls = [];
  const flow = mcFlow(async (...args) => { calls.push(args); return envelope(); });
  const pending = flow.verify({ method });
  assert.equal(b.opened[0][0], "about:blank");
  await assert.rejects(flow.verify({ method }), /already running/);
  await flush();
  assert.equal(b.frames.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "POST");
  assert.equal(calls[0][1], `/agentic-tokens/card-token/otp/${encodeURIComponent(method.identifier)}`);
  assert.equal(calls[0][2].data.type, "otp_methods");
  assert.equal(calls[0][2].data.attributes.client_ref_id, "vgs:ms:lookup:v1:enrollment-context");
  assert.equal(calls[0][2].data.attributes.browser_origin, origin);
  assert.equal(b.opened[1], prepared.launch_uri);
  b.emit({ action: "Ready" }, "https://evil.example");
  b.emit({ action: "Ready" }, mcOrigin, {});
  assert.equal(b.commands.length, 0);
  b.emit({ action: "Ready" }); b.emit({ action: "Ready" });
  assert.deepEqual(b.commands, [[{ action: "Authenticate", payload: prepared.authentication_payload }, mcOrigin]]);
  b.emit({ action: "Success", payload: mcSuccess });
  assert.deepEqual(await pending, { status: "verified", raw: mcSuccess, assuranceData: assurance });
  assert.equal(b.listeners.size, 0);
  assert.equal(b.timers.size, 0);
  assert.equal(b.popup.closed, true);
});

test("the same verify method drives Visa session creation, FIDO, proof mapping and cleanup", async (t) => {
  const b = surface(t);
  const calls = [];
  const flow = visaFlow(async (...args) => { calls.push(args); return { data: { attributes: {
    passkey_required: true, authenticationContext: { action: "AUTHENTICATE", providerContext: "opaque" },
  } } }; });
  const result = await flow.verify({ container: b.container });
  assert.equal(result.status, "verified");
  assert.equal(b.opened.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "/agentic-tokens/visa-token/device-attestations");
  assert.deepEqual(calls[0][2].data.attributes.sessionContext, { sessionId: "visa-session" });
  assert.deepEqual(calls[0][2].data.attributes.browserData, { browserHeader: "provider-browser-data" });
  assert.equal(calls[0][2].data.attributes.client_ref_id, "visa-enrollment-reference");
  assert.equal(result.assuranceData[0].methodResults.fidoAssertionData.code, "visa-proof");
  assert.equal(result.assuranceData[0].methodResults.dfpSessionId, "device-fingerprint");
  assert.equal(b.frames[0].style.display, "block");
  assert.equal(b.frames[0].removed, true);
  assert.equal(b.listeners.size, 0);
});

test("Visa issuer OTP stays inside verify with application-supplied input, and is never fabricated", async (t) => {
  const b = surface(t);
  const otp = { method: "OTPSMS", identifier: "opaque/sms==" };
  const calls = [];
  const flow = visaFlow(async (verb, path, body) => {
    calls.push({ verb, path, body });
    if (path.endsWith("device-attestations")) return { data: { attributes: {
      status: "CHALLENGE", passkey_required: true, stepUpRequest: [otp],
    } } };
    if (path.endsWith("/otp")) return { data: { attributes: {
      status: "APPROVED", authenticationContext: { action: "AUTHENTICATE" },
    } } };
    return { data: { attributes: { method: "SMS" } } };
  });
  const result = await flow.verify({ container: b.container, onChallenge: async (session) => {
    assert.deepEqual(session.otpMethods, [otp]);
    await session.requestOtp(otp);
    await session.submitOtp("012345");
  } });
  assert.equal(result.status, "verified");
  assert.equal(calls[1].path, "/agentic-tokens/visa-token/otp/opaque%2Fsms%3D%3D");
  assert.equal(calls[2].body.data.attributes.otp, "012345");
  assert.deepEqual(calls[2].body.data.attributes.session_context, { sessionId: "visa-session" });
  assert.equal(b.listeners.size, 0);
});

test("Visa legacy startSession/authenticate clients keep their existing assuranceData return", async (t) => {
  const b = surface(t);
  const flow = visaFlow(async () => ({ data: { attributes: {
    passkey_required: true, authenticationContext: { action: "AUTHENTICATE" },
  } } }));
  const session = await flow.startSession(b.container);
  const proof = await session.authenticate();
  assert.equal(proof[0].methodResults.fidoAssertionData.code, "visa-proof");
  session.destroy();
  assert.equal(b.listeners.size, 0);
});

test("a passkey-exempt Visa OTP flow returns the common result without starting FIDO", async (t) => {
  const b = surface(t);
  const otp = { method: "OTPSMS", identifier: "sms" };
  const flow = visaFlow(async (_verb, path) => {
    if (path.endsWith("device-attestations")) return { data: { attributes: {
      status: "CHALLENGE", passkey_required: false, stepUpRequest: [otp],
    } } };
    return { data: { attributes: { status: "VALIDATED" } } };
  });
  const result = await flow.verify({ container: b.container, onChallenge: async (session) => {
    await session.requestOtp(otp); await session.submitOtp("012345");
  } });
  assert.equal(result.status, "verified");
  assert.deepEqual(result.assuranceData, []);
  assert.equal(b.commands.some(([command]) => command.type === "AUTHENTICATE"), false);
  assert.equal(b.frames[0].removed, true);
  assert.equal(b.listeners.size, 0);
});

test("an existing Visa session can finish through the same verify entry point", async (t) => {
  const b = surface(t);
  const flow = visaFlow(async () => ({ data: { attributes: {
    passkey_required: true, authenticationContext: { action: "AUTHENTICATE" },
  } } }));
  const session = await flow.startSession(b.container);
  const result = await flow.verify({ session });
  assert.equal(result.status, "verified");
  assert.equal(b.frames[0].removed, true);
});

test("blocked or already cancelled browser verification sends no API request", async (t) => {
  surface(t, { blocked: true });
  const flow = mcFlow(() => assert.fail("must not request preparation"));
  await assert.rejects(flow.verify({ method }), /popups/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(flow.verify({ method, signal: controller.signal }), { code: "verification_cancelled" });
});

test("cancellation during pending Mastercard preparation prevents late navigation and releases the flow", async (t) => {
  const b = surface(t);
  let release;
  const flow = mcFlow(() => new Promise((resolve) => { release = resolve; }));
  const controller = new AbortController();
  const pending = flow.verify({ method, signal: controller.signal });
  const rejected = assert.rejects(pending, { code: "verification_cancelled" });
  controller.abort();
  await rejected;
  release(envelope()); await flush();
  assert.equal(b.opened.length, 1);
  assert.equal(b.popup.closed, true);
  assert.equal(b.listeners.size, 0);
  assert.equal(b.timers.size, 0);
});

test("Visa cancellation removes iframe listeners while waiting for readiness or a FIDO result", async (t) => {
  for (const phase of ["ready", "authenticate"]) await t.test(phase, async (t) => {
    const b = surface(t, { ready: phase !== "ready", authenticate: false });
    const flow = visaFlow(async () => ({ data: { attributes: {
      passkey_required: true, authenticationContext: { action: "AUTHENTICATE" },
    } } }));
    const controller = new AbortController();
    const pending = flow.verify({ container: b.container, signal: controller.signal });
    const rejected = assert.rejects(pending, { code: "verification_cancelled" });
    await flush(); controller.abort(); await rejected;
    assert.equal(b.frames[0].removed, true);
    assert.equal(b.listeners.size, 0);
  });
});

test("rejected issuer OTP cannot advance Visa to FIDO or mark an exempt session verified", async (t) => {
  for (const passkey of [false, true]) await t.test(`passkey=${passkey}`, async (t) => {
    const b = surface(t);
    const otp = { method: "OTPSMS", identifier: "sms" };
    const flow = visaFlow(async (_verb, path) => {
      if (path.endsWith("device-attestations")) return { data: { attributes: {
        status: "CHALLENGE", passkey_required: passkey, stepUpRequest: [otp],
      } } };
      return { data: { attributes: { status: "REJECTED" } } };
    });
    await assert.rejects(flow.verify({ container: b.container, onChallenge: async (session) => {
      await session.requestOtp(otp); await session.submitOtp("000000");
    } }), /not completed/);
    assert.equal(b.commands.some(([command]) => command.type === "AUTHENTICATE"), false);
    assert.equal(b.frames[0].removed, true);
  });
});

test("default transport preserves the API error body without opening a Visa iframe for Mastercard", async (t) => {
  const b = surface(t);
  const body = { error: "validation_error", detail: "Invalid reference", meta: { observability: { trace_id: "test" } } };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `https://api.example/agentic-tokens/card-token/otp/${encodeURIComponent(method.identifier)}`);
    assert.equal(options.headers.Authorization, "Bearer synthetic-test-token");
    return Response.json(body, { status: 422 });
  });
  const flow = new VgsAgenticAuth({ tokenId: "card-token", environment: "sandbox", clientRefId: "vgs:ms:v1:attempt",
    apiBase: "https://api.example", accessToken: "synthetic-test-token" });
  await assert.rejects(flow.verify({ method }), (error) => {
    assert.ok(error instanceof VgsAgenticAuthError);
    assert.equal(error.status, 422);
    assert.deepEqual(error.body, body);
    return true;
  });
  assert.equal(b.frames.length, 0);
  assert.equal(b.popup.closed, true);
  assert.equal(b.listeners.size, 0);
});
