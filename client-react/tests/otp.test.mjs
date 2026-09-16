import assert from "node:assert/strict";
import { test } from "node:test";
import { flowFromEnrollResponse, stepsFor } from "../src/flow.ts";
import { getStepUpOptions, requestOtp, submitOtp, completeEnrollment, IdvError } from "../src/idv.ts";

for (const verification of [null, "passkey", "otp", "none"]) {
  for (const enrollmentRequired of [false, true]) {
    test(`Visa preserves ${verification ?? "legacy"} flow, enrollment=${enrollmentRequired}`, () => {
      const verificationSteps = verification === "none" ? []
        : [verification === "otp" ? "idv" : "deviceBinding"];
      assert.deepEqual(stepsFor("visa", verification, enrollmentRequired), [
        "card", "enroll", ...verificationSteps,
        ...(enrollmentRequired ? ["agenticEnroll"] : []), "intent", "cryptogram", "confirm",
      ]);
    });

    test(`Mastercard preserves ${verification ?? "legacy"} flow, enrollment=${enrollmentRequired}`, () => {
      assert.deepEqual(stepsFor("mastercard", verification, enrollmentRequired), ["card", "enroll", "cryptogram"]);
    });

    test(`Amex ${verification ?? "legacy"} flow, enrollment=${enrollmentRequired}`, () => {
      assert.deepEqual(stepsFor("amex", verification, enrollmentRequired), [
        "card", "enroll", ...(verification === "otp" ? ["idv"] : []), "cryptogram",
      ]);
    });
  }
}

test("missing and unknown verification fields keep legacy defaults", () => {
  for (const response of [undefined, {}, { data: {} }, { data: { attributes: {} } },
    { data: { attributes: { cardholder_verification: "unexpected", agentic_enrollment_required: "true" } } }]) {
    assert.deepEqual(flowFromEnrollResponse(response), {
      verification: "passkey", agenticEnrollmentRequired: false,
    });
  }
});

test("Amex enrollment selects OTP only when the API explicitly requests it", () => {
  const { verification, agenticEnrollmentRequired } = flowFromEnrollResponse({
    data: { attributes: {
      cardholder_verification: "otp", agentic_enrollment_required: false,
      client_ref_id: "opaque-reference", stepUpRequest: [{ method: "OTPEMAIL", identifier: "channel" }],
    } },
  });
  assert.deepEqual(stepsFor("amex", verification, agenticEnrollmentRequired), ["card", "enroll", "idv", "cryptogram"]);
});

test("Visa can still fetch OTP methods and complete enrollment with the existing contract", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options });
    return Response.json({ data: { attributes: {
      status: "CHALLENGE", passkey_required: false,
      stepUpRequest: [{ method: "OTPSMS", identifier: "sms" }, { method: "FIDO", identifier: "passkey" }],
    } } });
  });
  const options = await getStepUpOptions("token", "reference");
  assert.equal(options.passkeyRequired, false);
  assert.deepEqual(options.methods, [{ method: "OTPSMS", identifier: "sms" }]);
  assert.equal(calls[0].url, "/api/step-up-options?tokenId=token&clientRefId=reference");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].body, undefined);
  await completeEnrollment("token", "cardholder@example.com");
  assert.equal(calls[1].url, "/api/agentic-enrollments?tokenId=token");
  assert.deepEqual(JSON.parse(calls[1].body), {
    data: { type: "agentic_enrollments", attributes: { consumer_email: "cardholder@example.com" } },
  });
});

test("OTP delivery, resend and verification preserve opaque references and the existing request fields", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options });
    return new Response(null, { status: 204 });
  });
  const reference = "opaque/provider+reference=";
  await requestOtp("token/id", reference, "channel/id");
  await requestOtp("token/id", reference, "channel/id");
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(calls[0].url, "/api/otp/channel%2Fid?tokenId=token%2Fid");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(JSON.parse(calls[0].body), {
    data: { type: "otp_methods", attributes: { client_ref_id: reference } },
  });
  await submitOtp("token/id", reference, "cardholder@example.com", "123456");
  assert.equal(calls[2].url, "/api/otp?tokenId=token%2Fid");
  assert.deepEqual(JSON.parse(calls[2].body), {
    data: { type: "otp_submissions", attributes: {
      otp: "123456", client_ref_id: reference, consumer_email: "cardholder@example.com",
      session_context: {}, browser_data: {},
    } },
  });
});

test("a rejected OTP remains an error and cannot complete verification", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    error: "invalid_otp", detail: "Incorrect code",
  }, { status: 400 }));
  await assert.rejects(submitOtp("token", "reference", "cardholder@example.com", "000000"), (error) => {
    assert.ok(error instanceof IdvError);
    assert.equal(error.status, 400);
    assert.equal(error.code, "invalid_otp");
    return true;
  });
});
