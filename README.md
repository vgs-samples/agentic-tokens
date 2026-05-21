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

## VGS Marketing Agency — agentic SaaS demo

On top of the Agentic Tokens building blocks, the repo ships a quick-start demo of a fictional dev-tool startup called **VGS Marketing Agency**. It lets any AI agent connected via MCP:

1. **generate a marketing landing page in the chat itself** — Claude writes the HTML, renders it as an Artifact for the user to preview live,
2. attempt to publish — the server returns `payment_required` ($5/month hosting),
3. propose the subscription to the user,
4. on approval, run the existing VGS device-binding flow (TouchID / FIDO / OTP) and create a recurring intent + cryptogram,
5. retry `publish_site` with the same HTML — site becomes live at `https://<your-site>/s/<siteId>`.

The HTML is generated client-side by the LLM and only reaches the server after the user pays. No server-side template, no drafts.

Two transports ship together:

- **HTTP** — deployed at `/mcp` via `netlify/functions/mcp.js`. Connect a remote MCP client to `https://<your-site>/mcp` — no local install.
- **stdio** — `node mcp-server/src/index.js` for desktop MCP clients (Claude Desktop, Claude Code, Codex). Auto-opens browser tabs at the right moments.

See `mcp-server/README.md` for the demo script, the tool contract, and copy-paste configs.
