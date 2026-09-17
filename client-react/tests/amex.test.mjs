import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEnrollmentAlreadyExists, deleteAmexEnrollment, AMEX_ENROLLMENT_EXAMPLE, enrollmentAttributes, paymentOutcome } from '../src/amex.ts';

test('legacy Visa and Mastercard enrollment is unchanged', () => {
  assert.deepEqual(enrollmentAttributes('buyer@example.com'), { consumer_email: 'buyer@example.com' });
});
test('Amex reuses email/device identifiers and forwards actual risk and names', () => {
  const attrs = enrollmentAttributes('buyer@example.com', {
    firstName: ' Jane ', lastName: 'Doe', deviceId: 'device', ipAddress: '192.0.2.1',
    language: 'en-US', formFactor: 'DESKTOP', browserUserAgent: 'test browser',
    distinctBillingLastNameCount: '1', agent: { agent_name: 'Demo' },
  });
  assert.equal(attrs.device_id, 'device');
  assert.equal(attrs.consumer_first_name, 'Jane');
  assert.equal(attrs.browser_data.ipAddress, '192.0.2.1');
  assert.equal(attrs.risk.device.device_id, undefined);
  assert.equal(attrs.risk.account.fpan_source, 'ONFILE');
});
test('cleared enrollment fields are still rejected', () => {
  assert.throws(() => enrollmentAttributes('buyer@example.com', {
    firstName: '', lastName: '', deviceId: 'device', ipAddress: '', language: 'en',
    formFactor: '', browserUserAgent: '', distinctBillingLastNameCount: '', agent: { agent_name: 'Demo' },
  }));
});
test('payment challenge is never reported as a final credential', () => {
  const outcome = paymentOutcome({ data: { id: 'pc', attributes: {
    status: 'PENDING_STEP_UP', client_ref_id: 'vgs:amex:v1:session',
    stepUpRequest: [{ method: 'OTPSMS', identifier: 'sms' }],
  } } });
  assert.equal(outcome.credential, undefined);
  assert.equal(outcome.challenge.clientRefId, 'vgs:amex:v1:session');
});
test('only a response containing a payment credential completes payment', () => {
  assert.throws(() => paymentOutcome({ data: { id: 'pc', attributes: { status: 'ACTIVE' } } }));
  assert.throws(() => paymentOutcome({ data: { attributes: { status: 'PENDING_STEP_UP' } } }));
  const attrs = { status: 'ACTIVE', network_token: 'test-token', cryptogram: { value: 'test' } };
  assert.deepEqual(paymentOutcome({ data: { attributes: attrs } }), { credential: attrs });
});

test('spec example prefill supplies all required enrollment details', () => {
  const attrs = enrollmentAttributes('buyer@example.com', {
    ...AMEX_ENROLLMENT_EXAMPLE, language: 'uk-UA', browserUserAgent: 'current browser',
  });
  assert.equal(attrs.consumer_id, 'user-12345');
  assert.equal(attrs.consumer_first_name, 'Jane');
  assert.equal(attrs.consumer_last_name, 'Jones');
  assert.equal(attrs.device_id, '565266');
  assert.equal(attrs.browser_data.ipAddress, '192.168.1.1');
  assert.equal(attrs.browser_data.browserLanguage, 'uk-UA');
  assert.equal(attrs.browser_data.userAgent, 'current browser');
  assert.equal(attrs.risk.device.form_factor, 'MOBILE');
  assert.equal(attrs.risk.account.distinct_billing_last_name_count, '2');
  assert.deepEqual(attrs.agents, [{ agent_name: 'NexusAI', llm_version: 'gpt-4.1' }]);
});

test('deletion sends the edited enrollment ID, without a body, and preserves API failures', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    return Response.json({ error: 'amex_upstream_error' }, { status: 409 });
  });
  const result = await deleteAmexEnrollment(' custom/id+value= ');
  assert.equal(calls[0].url, '/api/amex-enrollments?enrollmentId=custom%2Fid%2Bvalue%3D');
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].body, undefined);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { error: 'amex_upstream_error' });
  assert.throws(() => deleteAmexEnrollment('   '));
  assert.equal(calls.length, 1);
});

test('enrollment conflict recovery matches only the already-existing enrollment error', () => {
  const body = { error: 'amex_upstream_error', detail: 'Enrollment already exists.' };
  assert.equal(isEnrollmentAlreadyExists(409, body), true);
  assert.equal(isEnrollmentAlreadyExists(400, body), false);
  assert.equal(isEnrollmentAlreadyExists(200, body), false);
  assert.equal(isEnrollmentAlreadyExists(409, { detail: 'Mandatory data missing' }), false);
  for (const missing of [null, undefined, '', {}, { error: 'amex_upstream_error' }]) {
    assert.equal(isEnrollmentAlreadyExists(409, missing), false);
  }
});
