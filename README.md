# Agentic Tokens — Sample App

Reference app demonstrating the full VGS Agentic Tokens API integration flow.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your credentials

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

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VGS_CLIENT_ID` | (required) | OAuth client ID |
| `VGS_CLIENT_SECRET` | (required) | OAuth client secret |
| `VGS_API_URL` | `https://gw-01-sandbox.vgsapi.com` | Agentic API base URL |
| `VGS_CMP_API_URL` | `https://sandbox.vgsapi.com` | CMP API base URL (card creation) |
| `PORT` | `3000` | Server port |
