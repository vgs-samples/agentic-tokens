# Agentic Tokens — Sample App

Reference app demonstrating the full VGS Agentic Tokens API integration flow.

## Prerequisites

You need a VGS **Client ID** and **Client Secret** to run this app. Follow the [Authentication guide](https://docs.verygoodsecurity.com/cmp/platform/authentication) to generate your credentials.

## Quick Start

```bash
cp .env.example .env
# Set VGS_CLIENT_ID and VGS_CLIENT_SECRET (see Prerequisites)

docker compose up --build
```

Open https://localhost:4200 (accept the self-signed certificate warning).

## Architecture

- **Caddy** (port 4200) — serves the static frontend over HTTPS
- **Server** (port 3000) — Node.js API proxy that authenticates with VGS and forwards requests

## Flow

1. **Create Card** — creates a Visa test card (sandbox only)
2. **Enroll Token** — provisions the card for agentic payments
3. **Device Binding** — FIDO/OTP authentication via VgsAgenticAuth SDK
4. **Create Intent** — creates a spending authorization with mandates
5. **Get Cryptogram** — retrieves DPAN + cryptogram for payment

Each step auto-populates IDs into the next step.

> **Sandbox tip:** When prompted for an OTP code during Device Binding (step 3), use `456789` — it is always accepted in sandbox.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VGS_CLIENT_ID` | (required) | OAuth client ID ([how to get one](https://docs.verygoodsecurity.com/cmp/platform/authentication)) |
| `VGS_CLIENT_SECRET` | (required) | OAuth client secret |
| `VGS_API_URL` | `https://gw-01-sandbox.vgsapi.com` | Agentic Tokens API base URL |
| `VGS_CMP_API_URL` | `https://sandbox.vgsapi.com` | Card Management Platform (CMP) API base URL |
| `PORT` | `3000` | Server port |

### API URLs by environment

| | Sandbox | Live |
|---|---|---|
| `VGS_API_URL` | `https://gw-01-sandbox.vgsapi.com` | `https://gw-01-live.vgsapi.com` |
| `VGS_CMP_API_URL` | `https://sandbox.vgsapi.com` | `https://vgsapi.com` |

## Deploy to Netlify

The repo is set up to deploy as a Netlify site: the React build is served as static assets and the Express proxy is replaced by Netlify Functions that share the same VGS client (`server/vgs.js`).

### Setup (one-time)

1. In Netlify, **Add new site → Import from Git** and connect this repo.
2. Build settings are picked up from `netlify.toml` — no overrides needed.
3. Set **Site settings → Environment variables**: `VGS_CLIENT_ID`, `VGS_CLIENT_SECRET` (required), plus any optional VGS URLs / vault settings.
4. **Branches → Production branch** = `main`. Every push to `main` triggers a fresh deploy.

### Local development with Netlify Functions

Docker (`docker compose up`) still works as before. To run the Netlify build locally instead:

```bash
npm install -g netlify-cli
netlify dev
```

`netlify dev` serves the Vite frontend and emulates the Functions, so the local environment matches production.

## MCP Agent Demo

This repo also includes a local stdio MCP server in `mcp-server/`. It exposes a mock sneaker catalog and an agentic purchase tool:

1. the agent searches mock products,
2. asks the user to approve the exact product and price,
3. opens the card collection page if the mock buyer has no card,
4. opens the Visa device-binding page for purchase authentication,
5. creates the intent and returns a VGS payment cryptogram.

Run the sample app first, then point your MCP client at:

```bash
node /Users/flor/workspase/work/agentic-tokens/mcp-server/src/index.js
```

See `mcp-server/README.md` for the tool contract and environment variables.
