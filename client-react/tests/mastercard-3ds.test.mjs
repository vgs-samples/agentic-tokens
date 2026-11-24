import assert from "node:assert/strict";
import { test } from "node:test";
import { getStepUpOptions, launchThreeDs, verifyCardholder, readAuthenticationUiPreparation, readThreeDsResult } from "../src/idv.ts";

const origin = "https://localhost:4200";
const mcOrigin = "https://sandbox.src.mastercard.com";
const prepared = {
  launch_uri: `${mcOrigin}/auth?origin=${encodeURIComponent(origin)}`,
  authentication_payload: {
    srcClientId: "public-client", serviceId: "public-service", srcCorrelationId: "lookup-correlation", traceId: "lookup-affinity",
    accountReference: { srcDigitalCardId: "enrolled-token" },
    authenticationMethod: { authenticationMethodType: "3DS", authenticationSubject: "CARDHOLDER" },
  },
};
const proof = { verificationType: "CARDHOLDER", verificationEntity: "03", verificationMethod: "01",
  verificationResults: "01", additionalData: "opaque-provider-proof" };
const success = { srcCorrelationId: "lookup-correlation", traceId: "lookup-affinity",
  authenticationStatus: "COMPLETE", authenticationResult: "AUTHENTICATED", assuranceData: { verificationData: [proof], eci: "02" } };
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("enrollment 3DS preparation needs no merchant, acquiring or billing input", async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const b = browser();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { ...b.host, location: { origin } } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/otp/lookup-identifier?tokenId=enrolled-token");
    assert.deepEqual(JSON.parse(options.body), { data: { type: "otp_methods", attributes: {
      client_ref_id: "vgs:ms:v1:enrollment-reference", browser_origin: origin,
      dpa_locale: /^[a-z]{2}[-_][a-z]{2}$/i.test(navigator.language) ? navigator.language.replace("-", "_") : "en_US",
    } } });
    return Response.json({ data: { id: "lookup-identifier", type: "otp_methods",
      attributes: { method: "3DS", authenticationContext: prepared } } });
  });
  const pending = verifyCardholder("enrolled-token", "vgs:ms:v1:enrollment-reference",
    { method: "3DS", identifier: "lookup-identifier" });
  await flush();
  b.emit({ action: "Ready" });
  b.emit({ action: "Success", payload: success });
  assert.deepEqual(await pending, { status: "verified", raw: success, assuranceData: success.assuranceData });
});

function browser(blocked = false) {
  const listeners = new Set();
  const timers = new Map();
  const sent = [];
  const opened = [];
  let id = 0;
  const popup = { closed: false, location: { replace(url) { opened.push(url); } },
    close() { this.closed = true; }, postMessage(...args) { sent.push(args); } };
  const host = {
    open(...args) { opened.push(args); return blocked ? null : popup; },
    addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); },
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(key) { timers.delete(key); },
    setInterval(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearInterval(key) { timers.delete(key); },
  };
  return { host, popup, sent, opened, timers, listeners,
    emit(data, from = mcOrigin, source = popup) { for (const fn of listeners) fn({ data, origin: from, source }); } };
}

test("Mastercard lookup exposes executable 3DS without changing Visa OTP selection", async (t) => {
  const methods = [
    { method: "3DS", identifier: "vgs:ms:v1:browser-context", uriData: { uri: `${mcOrigin}/auth`, uriType: "WEB_URI" } },
    { method: "MANAGED_AUTHENTICATION", uriData: { uri: `${mcOrigin}/auth`, uriType: "WEB_URI" } },
    { method: "FIDO2", identifier: "unhandled" }, { method: "OTPSMS", identifier: "sms" },
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: { attributes: { passkey_required: false, stepUpRequest: methods } } }));
  assert.deepEqual((await getStepUpOptions("token", "vgs:ms:v1:attempt")).methods, [methods[0], methods[3]]);
  assert.deepEqual((await getStepUpOptions("token", "visa-attempt")).methods, [methods[3]]);
});

test("preparation must match the card, exact Mastercard host and caller origin", () => {
  const envelope = (context) => ({ data: { id: "lookup-identifier", type: "otp_methods",
    attributes: { method: "3DS", authenticationContext: context } } });
  assert.deepEqual(readAuthenticationUiPreparation(envelope(prepared), "enrolled-token", "lookup-identifier", origin), prepared);
  for (const launch_uri of ["https://evil.example/auth", `${mcOrigin}.evil.example/auth`,
    `${mcOrigin}/auth?origin=https://evil.example`, `${prepared.launch_uri}&redirect=evil`,
    `https://user:pass@sandbox.src.mastercard.com/auth?origin=${encodeURIComponent(origin)}`]) {
    assert.throws(() => readAuthenticationUiPreparation(envelope({ ...prepared, launch_uri }), "enrolled-token", "lookup-identifier", origin));
  }
  assert.throws(() => readAuthenticationUiPreparation(envelope(prepared), "another-card", "lookup-identifier", origin));
  assert.throws(() => readAuthenticationUiPreparation(envelope(prepared), "enrolled-token", "another-method", origin));
  assert.throws(() => readAuthenticationUiPreparation({ data: { id: "lookup-identifier", type: "otp_methods",
    attributes: { method: "SMS", authenticationContext: prepared } } }, "enrolled-token", "lookup-identifier", origin));
});

test("only trusted popup Ready initializes once; matching success returns the provider proof unchanged", async () => {
  const b = browser();
  const flow = launchThreeDs(b.host, async () => prepared, origin, () => {});
  assert.equal(b.opened[0][0], "about:blank");
  await flush();
  assert.equal(b.opened[1], prepared.launch_uri);
  b.emit({ action: "Success", payload: success });
  b.emit({ action: "Ready" }, "https://evil.example");
  b.emit({ action: "Ready" }, mcOrigin, {});
  assert.equal(b.sent.length, 0);
  b.emit({ action: "Ready" }); b.emit({ action: "Ready" });
  assert.deepEqual(b.sent, [[{ action: "Authenticate", payload: prepared.authentication_payload }, mcOrigin]]);
  b.emit({ action: "Success", payload: success }, "https://evil.example");
  assert.equal(b.popup.closed, false);
  b.emit({ action: "Success", payload: success });
  assert.deepEqual(await flow.result, { raw: success, assuranceData: success.assuranceData });
  assert.equal(b.popup.closed, true);
  assert.equal(b.listeners.size, 0);
  assert.equal(b.timers.size, 0);
});

test("blocked popups do not call the preparation endpoint", () => {
  assert.throws(() => launchThreeDs(browser(true).host, () => assert.fail("no request"), origin, () => {}), /popups/);
});

test("cancellation, close, timeout, provider Error and preparation failures cannot complete verification", async () => {
  for (const mode of ["cancel", "close", "timeout", "error", "preparation"]) {
    const b = browser();
    const flow = launchThreeDs(b.host, async () => {
      if (mode === "preparation") throw new Error("HTTP 500");
      return prepared;
    }, origin, () => {});
    const rejected = assert.rejects(flow.result);
    await flush();
    if (mode === "cancel") flow.cancel();
    if (mode === "close") { b.popup.closed = true; [...b.timers.values()].find(({ ms }) => ms === 500).fn(); }
    if (mode === "timeout") [...b.timers.values()].find(({ ms }) => ms === 600000).fn();
    if (mode === "error") { b.emit({ action: "Ready" }); b.emit({ action: "Error", payload: { reason: "DECLINED" } }); }
    await rejected;
    assert.equal(b.listeners.size, 0);
    assert.equal(b.timers.size, 0);
  }
});

test("cancelling while preparation is pending prevents late navigation", async () => {
  const b = browser();
  let complete;
  const flow = launchThreeDs(b.host, () => new Promise((resolve) => { complete = resolve; }), origin, () => {});
  const rejected = assert.rejects(flow.result);
  flow.cancel(); complete(prepared);
  await rejected; await flush();
  assert.equal(b.opened.length, 1);
});

test("success requires completed authentication, matching context and a positive 3DS proof", () => {
  assert.deepEqual(readThreeDsResult(success, prepared), success.assuranceData);
  for (const update of [
    { srcCorrelationId: "other-attempt" }, { traceId: "other-affinity" },
    { authenticationStatus: "PENDING" }, { authenticationStatus: "CANCELLED" },
    { authenticationResult: "NOT_AUTHENTICATED" }, { assuranceData: null },
    { assuranceData: { verificationData: [] } },
    { assuranceData: { verificationData: [{ ...proof, verificationResults: "02" }] } },
    { assuranceData: { verificationData: [{ ...proof, verificationMethod: "07" }] } },
    { assuranceData: { verificationData: [{ ...proof, additionalData: "" }] } },
  ]) assert.throws(() => readThreeDsResult({ ...success, ...update }, prepared));
});
