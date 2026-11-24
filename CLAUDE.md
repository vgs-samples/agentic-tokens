# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A reference/demo app for the VGS Agentic Tokens API. Sandbox only. It supports three card-network flows, with the UI adapting to whichever network the card resolves to:

- **Visa** (full flow): Create Card → Enroll Token → Device Binding (FIDO/OTP) → Create Intent → Get Cryptogram → Confirm Transaction.
- **Mastercard** (SCOF / Agent Pay): Create Card → Enroll Token → Get Cryptogram (checkout). No device binding, no intent ("verifiable intent" not yet enabled upstream), no confirmation.
- **Amex** (ACE / Agentic Commerce): Create Card → Enroll Token → optional OTP verification → Get Payment Credential. OTP runs only when enrollment explicitly requests it; use its `client_ref_id` and `stepUpRequest`. Older responses retain the direct credential flow. No device binding, no intent, no confirmation.

**Cardholder verification is discovered from the API, never configured here.** The enroll response
carries `data.attributes.cardholder_verification` (`passkey` / `otp` / `none`) and
`data.attributes.agentic_enrollment_required`; `EnrollToken.tsx` stores both via
`setFlowFromEnrollment`, and `stepsFor(network, verification, agenticEnrollmentRequired)` in
`flow.ts` composes the step list from them. The header indicator is read-only — do not reintroduce
a flow switch, and do not probe an endpoint to guess the flow.

- **`passkey`** — FIDO passkey ceremony in a Visa iframe, driven by `vgs-agentic-auth.js`; produces
  `assurance_data` for intent creation. (Visa may still demand a one-time code first; that is per
  attempt, reported as `session.needsOtp`, not by `cardholder_verification`.)
- **`otp`** — passkey-exempt cardholder ID&V: a one-time passcode driven server-to-server, no iframe
  and no `assurance_data`. Flow: Create Card → Enroll Token → Cardholder Verification →
  [Complete Enrollment] → Create Intent → Get Cryptogram → Confirm Transaction, where the
  bracketed step appears only when `agentic_enrollment_required` is true.
- **`none`** — no verification step; enrollment goes straight to intent creation.

`agentic_enrollment_required` is independent of the verification value: it alone decides whether the
**Complete Enrollment** step appears (Visa requires that call *after* verification, before any intent).

ID&V HTTP helpers and the demo proxy adapter live in **`client-react/src/idv.ts`**.
All browser protocol handling belongs in **`vgs-agentic-auth.js`**: its common
`VgsAgenticAuth.verify(...)` runs Visa iframe/FIDO or Mastercard 3DS popup verification,
returns `{status, assuranceData, raw}`, and owns cancellation and cleanup.
Keep `idv.ts` free of popup/postMessage lifecycle code. Its `verifyCardholder()`
adapter injects the demo's `/api/otp` transport into the same SDK.
`DeviceBinding.tsx` and `MastercardThreeDs.tsx` both call `verify(...)`; the application
owns its OTP form through the Visa `onChallenge(session)` callback. Backend flow
signals and lookup methods remain the source of truth; do not add a network/flow switch.
Keep provider assurance data in memory, invalidate it on lookup/card/method/enrollment
changes, and forward it on SCOF checkout as `assurance_data` for Mastercard validation.
The browser flow creates no Mastercard passkey.

The network is resolved at card creation — from the preset test card or, for a custom PAN, the brand Collect.js reports (`networkFromCardType` in `client-react/src/flow.ts`) — and authoritatively reconciled from the enroll response (`reconcileNetwork`). The active flow drives which step blocks render and their numbering — see `stepsFor` and `NETWORK_PHASES` in `flow.ts`. Mastercard test card: `2222690420064574`; Amex test card: `379258101671003`, CID `1111`, exp `12/27`.

## Running

```bash
cp .env.example .env   # fill in VGS_CLIENT_ID and VGS_CLIENT_SECRET
docker compose up --build
```

Open https://localhost:4200 (accept the self-signed cert).

## Build & Lint (React client)

```bash
cd client-react
npm run build    # tsc -b && vite build
npm run lint     # eslint
npm run dev      # local vite dev server (outside Docker)
```

## Architecture

Three Docker services behind a shared compose network:

- **Caddy** (`Caddyfile`) — HTTPS reverse proxy on :443, mapped to host :4200. Routes `/api/*` to the Node server and everything else to the Vite dev server. Handles TLS with a self-signed cert for `localhost`.
- **Client** (`client-react/`) — Vite dev server on :5173. React + TypeScript + Tailwind. `src/` and `index.html` are volume-mounted for HMR.
- **Server** (`server/server.js`) — Express API proxy on :3000. Handles OAuth token management (client_credentials flow against VGS auth) and proxies all VGS API calls so credentials never reach the browser.

The frontend uses same-origin relative URLs (`/api/*`) — all traffic flows through Caddy, no CORS needed.

## Directory Layout

- `client-react/` — React + Vite + Tailwind frontend (TypeScript). Per-step components in `src/components/`.
- `server/` — Node.js API proxy (server.js, package.json, Dockerfile). ESM (`"type": "module"`).

## API Routes (server.js)

All routes proxy to VGS APIs with a Bearer token. The two base URLs are `VGS_API_URL` (agentic API) and `VGS_CMP_API_URL` (card management).

| Route | VGS API |
|---|---|
| `GET /api/token` | Returns access token for browser SDK |
| `POST /api/cards` | CMP — create test card |
| `POST /api/cards/:cardId/agentic-tokens` | Enroll card for agentic payments |
| `GET /api/step-up-options?tokenId=&clientRefId=` | ID&V — cardholder verification options (`clientRefId` required, URL-safe) |
| `POST /api/otp/:identifier?tokenId=` | ID&V — deliver SMS/email OTP or return Mastercard 3DS `authenticationContext` |
| `POST /api/otp?tokenId=` | ID&V — verify the code (completes verification) |
| `POST /api/agentic-enrollments?tokenId=` | ID&V — finish enrollment after verification |
| `POST /api/intents?tokenId=` | Create spending intent with mandates |
| `PUT /api/intents?tokenId=&intentId=` | Update intent |
| `DELETE /api/intents?tokenId=&intentId=` | Cancel intent |
| `POST /api/cryptograms?tokenId=&intentId=` | Visa — get DPAN + cryptogram (intent-scoped) |
| `POST /api/cryptograms?tokenId=&cardId=` | Mastercard/Amex — card-scoped credential (no intent) |

## Key Details

- The VGS SDK (`client-react/src/vgs-agentic-auth.js`) is vanilla JS loaded via dynamic `import()` in `DeviceBinding.tsx`. It handles Visa iframe/FIDO/OTP and Mastercard 3DS popup verification through `verify(...)`. It is a copy of `client/vgs-agentic-auth.js` in the maranui repo and should stay byte-identical except for the sample-only visible-iframe sizing — if you need library behavior, change it there first.
- ID&V uses `src/idv.ts` for HTTP/proxy adaptation and the SDK for browser verification. `CardholderIdv.tsx` and `CompleteEnrollment.tsx` own the forms and step progression.
- Step lists are composed by `stepsFor(network, verification, agenticEnrollmentRequired)` in `flow.ts` rather than a fixed table, since the flow facts are independent. `useAppState` memoizes the result as `flow` and exposes it; `App.tsx` renders `flow.map(...)` over a `Record<StepKey, ReactNode>` of step blocks, so the step list is the only thing that decides order, numbering, and which steps exist. `useStepStatus` reads the same array.
- App state lives in a single `useAppState` hook — step progression, loading states, and shared IDs (cardId, tokenId, intentId, assuranceData) flow down as props. `cardholderVerification` is `null` until the enroll response reports it.
- Shared UI primitives (`Field`, `Row`, `Button`) are in `src/components/ui.tsx`. The `.input` Tailwind utility class is defined in `src/index.css`.
