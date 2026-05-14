# VGS Agentic SDK

Browser SDK for integrating with the VGS Agentic Tokens API. Covers the full consumer flow for issuing agentic payment tokens:

1. Enroll a card into an agentic token
2. Device binding (Visa VTS iframe + FIDO/passkey, with optional OTP step-up)
3. Create an intent with mandates
4. Get a DPAN + cryptogram for processing
5. Send a transaction confirmation

PAN tokenization (creating `cardId`) is **out of scope** — use **VGS Collect.js**.

OAuth `client_credentials` is **server-side only** — it does not belong in the browser. The SDK obtains an `access_token` through your `tokenProvider` callback.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│                                                              │
│   VGS Collect.js  ──► cardId                                 │
│        │                                                     │
│        ▼                                                     │
│   VgsAgenticAuth ──► token ──► session ──► intent            │
│        │                │          │          │              │
│        │                │          │          ├─► cryptogram │
│        │                │          │          └─► confirm    │
└────────┼────────────────┼──────────┼──────────────────────────┘
         │                │          │
         │                │          │
         ▼                ▼          ▼
   VGS CMP API      VGS Agentic API  Visa VTS iframe
   (PAN tokenize)   (REST)           (postMessage)

   Your backend: GET /api/token?scope=... → access_token
                 (token broker only)
```

All runtime calls go directly from the browser to VGS / Visa. Your server participates only as a **token broker** — issuing scoped access tokens via `client_credentials`.

---

## Installation

```bash
npm install @vgs/agentic-sdk
```

```js
import { VgsAgenticAuth } from "@vgs/agentic-sdk";
```

---

## Quickstart

```js
const auth = new VgsAgenticAuth({
  environment: "sandbox",                        // "sandbox" | "live"
  tokenProvider: (scope) =>
    fetch(`/api/token?scope=${scope}`)
      .then((r) => r.json())
      .then((d) => d.access_token),
});

// 1. Enroll card → AgenticToken
const token = await auth.enrollToken({
  cardId: "card_abc123",                         // from Collect.js
  consumerEmail: "user@example.com",
});

// 2. Device binding
const session = await token.startDeviceBinding(document.getElementById("auth"), {
  authenticationAmount: "100",
  currencyCode: "840",
  merchantName: "Best Buy",
});

if (session.needsOtp) {
  await session.requestOtp(session.otpMethods[0]);
  await session.submitOtp("456789");
}

await session.authenticate();                    // FIDO/passkey ceremony

// 3. Create intent (assuranceData is attached automatically)
const intent = await session.createIntent({
  consumerPrompt: "Allow monthly purchase up to $5.33 at Best Buy",
  mandates: [
    {
      description: "Monthly subscription",
      merchantCategory: "Electronics",
      preferredMerchantName: "Best Buy",
      merchantCategoryCode: "1234",
      declineThreshold: { amount: 5.33, currencyCode: "USD" },
      effectiveUntil: "2026-06-15T00:00:00Z",
      quantity: 1,
    },
  ],
});

// 4. Get cryptogram for a transaction
const cryptogram = await intent.getCryptogram({
  merchantCountryCode: "US",
  transactionAmount: { value: "5.33", currencyCode: "USD" },
  merchantName: "Best Buy",
  merchantUrl: "https://www.bestbuy.com",
});

// 5. Confirm transaction outcome
await intent.confirm({
  status: "APPROVED",                            // APPROVED | DECLINED | PENDING | ERROR | CANCELLED
  type: "PURCHASE",                              // PURCHASE | AUTHORIZATION | CAPTURE | REFUND | …
  amount: { value: "5.33", currencyCode: "USD" },
});
```

---

## API Reference

### `new VgsAgenticAuth(options)`

Root SDK factory. Create once per page.

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `environment` | `"sandbox" \| "live"` | yes | — | VGS environment. Determines API base URL and Visa VTS origin. |
| `tokenProvider` | `(scope: string) => Promise<string>` | yes | — | Callback to your backend. Returns an access_token for the given scope. Invoked on initialization and on `401`. |
| `fetch` | `typeof fetch` | no | `globalThis.fetch` | Custom fetch (for logging, proxying, e2e mocking). |
| `timeout` | `number` | no | `30000` | Timeout (ms) for device-binding iframe operations. |

#### `auth.enrollToken({ cardId, consumerEmail }): Promise<AgenticToken>`

Step 2. Enroll a card into an agentic token.

| Param | Type | Description |
|---|---|---|
| `cardId` | `string` | VGS card reference returned from Collect.js. |
| `consumerEmail` | `string` | Cardholder email — used for both enrollment and OTP step-up during device binding. |

**Returns:** `AgenticToken` — handle for subsequent steps. Carries `tokenId`.

**Idempotency:** repeated calls with the same `(cardId, consumerEmail)` return the existing `AgenticToken`.

**Scope:** `agentic:enroll`.

---

### `AgenticToken`

Handle to an enrolled agentic token. Do not call `new AgenticToken()` directly — obtain it from `auth.enrollToken()`.

| Property | Type | Description |
|---|---|---|
| `tokenId` | `string` | Agentic token ID. |

#### `token.startDeviceBinding(container, options): Promise<Session>`

Step 3. Mounts the Visa VTS iframe into `container`, performs device attestation, and returns a `Session`.

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `container` | `HTMLElement` | yes | — | DOM element to mount the iframe into. |
| `options.authenticationAmount` | `string` | no | `"100"` | Amount for the authentication context (minor units). |
| `options.currencyCode` | `string` | no | `"840"` | ISO-4217 numeric code (840 = USD). |
| `options.merchantName` | `string` | no | — | Merchant name for the authentication context. |
| `options.clientRefId` | `string` | no | `crypto.randomUUID()` | Idempotency key for the device-binding chain. |

**Returns:** `Session`.

**Scope:** `agentic:device-binding`.

---

### `Session`

State of a single device-binding ceremony. Has a state machine:

```
otp_method_pending  ──requestOtp()──►  otp_pending  ──submitOtp()──►  ready
                                                                       │
ready  ──(if needsOtp === false after startDeviceBinding)──────────────┘
   │
   ├──authenticate()──►  complete
   │
   └──destroy()──►  destroyed
```

| Property | Type | Description |
|---|---|---|
| `needsOtp` | `boolean` | `true` if VGS returned `status: "CHALLENGE"` and OTP step-up is required. |
| `otpMethods` | `OtpMethod[]` | Available OTP channels (SMS, email, …). Empty when `needsOtp === false`. |
| `iframe` | `HTMLIFrameElement` | Visa iframe — show/hide it around the FIDO prompt. |

#### `session.requestOtp(method): Promise<void>`

Request OTP delivery via the chosen method. Pass one of `session.otpMethods`.

Re-callable: while in state `otp_pending`, calling again triggers resend; passing a different method switches the channel.

#### `session.submitOtp(code): Promise<void>`

Submit the entered OTP code. Transitions the session to `ready`.

#### `session.authenticate(): Promise<void>`

Run the FIDO/passkey ceremony inside the iframe. On success the session transitions to `complete` and stores `assuranceData` internally (consumed by `createIntent`). The iframe is closed automatically.

#### `session.createIntent({ consumerPrompt, mandates }): Promise<Intent>`

Step 4. Creates an intent and auto-attaches `assuranceData` from the current session.

| Param | Type | Description |
|---|---|---|
| `consumerPrompt` | `string` | Human-readable description of the permission shown to the user. |
| `mandates` | `Mandate[]` | List of mandates (see below). |

`Mandate`:

| Field | Type | Description |
|---|---|---|
| `description` | `string` | Free-form description. |
| `merchantCategory` | `string` | Merchant category (`"Electronics"`, `"Grocery"`, …). |
| `preferredMerchantName` | `string` | Preferred merchant name. |
| `merchantCategoryCode` | `string` | MCC. |
| `declineThreshold` | `{ amount: number; currencyCode: string }` | Limit above which the transaction is declined. |
| `effectiveUntil` | `string` (ISO-8601) | Mandate expiration. |
| `quantity` | `number` | Allowed number of uses. |

**Returns:** `Intent`.

**Scope:** `agentic:intent`.

#### `session.destroy(): void`

Closes the iframe and removes event listeners. Safe to call multiple times. Call this on component unmount.

---

### `Intent`

Handle to a created intent. Obtained from `session.createIntent()`.

| Property | Type | Description |
|---|---|---|
| `intentId` | `string` | Intent ID. |
| `tokenId` | `string` | Parent agentic token ID. |

#### `intent.getCryptogram(transactionData): Promise<PaymentCredential>`

Step 5. Get a DPAN + cryptogram for processing.

| Field | Type | Description |
|---|---|---|
| `merchantCountryCode` | `string` | ISO-3166-1 alpha-2. |
| `transactionAmount` | `{ value: string; currencyCode: string }` | |
| `merchantName` | `string` | |
| `merchantUrl` | `string` | |

**Returns:** `PaymentCredential`:

```ts
{
  dpan: string;
  cryptogram: string;
  expMonth: string;
  expYear: string;
  // …
}
```

**Scope:** `agentic:cryptogram`.

#### `intent.confirm({ status, type, amount }): Promise<void>`

Step 6. Send the transaction outcome back to VGS — required for every `getCryptogram` call.

| Field | Type | Values |
|---|---|---|
| `status` | `string` | `APPROVED` \| `DECLINED` \| `PENDING` \| `ERROR` \| `CANCELLED` |
| `type` | `string` | `PURCHASE` \| `AUTHORIZATION` \| `CAPTURE` \| `REFUND` \| `REVERSAL` \| `VERIFICATION` \| `CHARGEBACK` \| `FRAUD` |
| `amount` | `{ value: string; currencyCode: string }` | |

**Scope:** `agentic:confirmation`.

#### `intent.update(patch): Promise<void>`

Update mandates on an existing intent.

#### `intent.cancel(): Promise<void>`

Cancel an intent.

---

## Token Broker (server side)

The SDK does not perform OAuth `client_credentials` — the secret must never leave your backend. Implement a minimal endpoint on your server:

```js
// Express
app.get("/api/token", async (req, res) => {
  const { scope } = req.query;
  const token = await getVgsAccessToken({ scope });   // client_credentials flow
  res.json({ access_token: token });
});
```

Things to keep in mind:
- **Scoping.** If your auth server supports scopes, issue narrow tokens per operation. This minimizes the blast radius if a token leaks.
- **TTL.** Keep it short (minutes). The SDK will refetch on `401`.
- **Do not cache per user.** This is `client_credentials` — the token identifies your application, not a user.

---

## Error handling

All SDK errors are instances of `VgsAgenticAuthError`:

```js
import { VgsAgenticAuthError } from "@vgs/agentic-sdk";

try {
  await session.submitOtp(code);
} catch (err) {
  if (err instanceof VgsAgenticAuthError) {
    console.error(err.message, err.status, err.code);
  }
}
```

| Property | Type | Description |
|---|---|---|
| `message` | `string` | Human-readable message. |
| `status` | `number \| null` | HTTP status when the error originates from the API. |
| `code` | `string \| null` | Machine-readable error code (`OTP_INVALID`, `DEVICE_NOT_BOUND`, …). |

---

## State machine (for debugging)

`Session` throws `VgsAgenticAuthError` with `Cannot call X() in state "Y"` if a method is called out of order. Allowed transitions:

```
                ┌──────────────────────┐
                │ otp_method_pending   │  (needsOtp = true)
                └────────┬─────────────┘
                         │ requestOtp(method)
                         ▼
                ┌──────────────────────┐
                │     otp_pending      │  ◄── resend via repeated requestOtp
                └────────┬─────────────┘
                         │ submitOtp(code)
                         ▼
                ┌──────────────────────┐
   start ─────► │        ready         │  (if needsOtp = false — enter here directly)
                └────────┬─────────────┘
                         │ authenticate()
                         ▼
                ┌──────────────────────┐
                │      complete        │  ──► destroy() ──► destroyed
                └──────────────────────┘
```

---

## SDK vs. raw REST

| Concern | Without SDK | With SDK |
|---|---|---|
| OAuth flow | Bearer attached manually on every call | `tokenProvider` once, auto refresh |
| Visa iframe lifecycle | `postMessage`, listeners, AUTH_READY/CREATE_AUTH_SESSION/… | `token.startDeviceBinding()` |
| `assuranceData` transform | manual from `fidoBlob` + `dfpSessionId` | handled by SDK |
| Passing `tokenId`/`intentId` between steps | query strings everywhere | encapsulated in `token`/`intent` |
| OTP state machine | hand-rolled | `session.needsOtp` + state guards |
| Idempotency | bring your own `clientRefId` | auto (overridable) |
| TypeScript types | DIY | shipped |

---

## Sandbox

In the sandbox environment the OTP code is always `456789`.

Test cards for Collect.js:

| PAN | CVV |
|---|---|
| `4622943123121569` | `814` |
| `4622943123121478` | `845` |

---

## Browser support

- Chrome / Edge (last 2 versions)
- Safari 16+
- Firefox (last 2 versions)

WebAuthn (FIDO2) is required — device binding will not work without it.

---

## License

Apache 2.0
