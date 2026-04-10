# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A reference/demo app for the VGS Agentic Tokens API. It walks through a 5-step payment flow: Create Card → Enroll Token → Device Binding (FIDO/OTP) → Create Intent → Get Cryptogram. Sandbox only.

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
| `POST /api/intents?tokenId=` | Create spending intent with mandates |
| `PUT /api/intents?tokenId=&intentId=` | Update intent |
| `DELETE /api/intents?tokenId=&intentId=` | Cancel intent |
| `POST /api/cryptograms?tokenId=&intentId=` | Get DPAN + cryptogram |

## Key Details

- The VGS SDK (`client-react/src/vgs-agentic-auth.js`) is vanilla JS loaded via dynamic `import()` in `DeviceBinding.tsx`. It handles the Visa iframe lifecycle, FIDO ceremony, and OTP flow.
- App state lives in a single `useAppState` hook — step progression, loading states, and shared IDs (cardId, tokenId, intentId, assuranceData) flow down as props.
- Shared UI primitives (`Field`, `Row`, `Button`) are in `src/components/ui.tsx`. The `.input` Tailwind utility class is defined in `src/index.css`.
