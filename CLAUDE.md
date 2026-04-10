# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A reference/demo app for the VGS Agentic Tokens API. It walks through a 5-step payment flow: Create Card → Enroll Token → Device Binding (FIDO/OTP) → Create Intent → Get Cryptogram. Sandbox only.

## Running

```bash
cp .env.example .env   # fill in VGS_CLIENT_ID and VGS_CLIENT_SECRET
docker compose up --build
```

Open https://localhost:4200 (accept the self-signed cert). No build step, no tests, no linter.

## Architecture

Two Docker services behind a shared compose network:

- **Caddy** (`Caddyfile`) — static file server on HTTPS :443, mapped to host :4200. Serves everything in `public/`.
- **Node server** (`server.js`) — Express API proxy on :3000. Handles OAuth token management (client_credentials flow against VGS auth) and proxies all VGS API calls so credentials never reach the browser. The frontend calls it via `http://localhost:3000/api/*`.

The frontend is vanilla JS (ES modules, no bundler). `public/app.js` drives the UI; `public/sdk/vgs-agentic-auth.js` is the VGS SDK for device binding (FIDO + OTP).

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

- ESM throughout (`"type": "module"` in package.json).
- No framework on the frontend — plain DOM manipulation with `window.*` function exports for onclick handlers.
- The frontend talks to the server over plain HTTP (:3000) with CORS `*`. Caddy only serves static files and doesn't reverse-proxy to the server.
