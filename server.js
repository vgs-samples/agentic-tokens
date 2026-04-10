import express from "express";
import { config } from "dotenv";

config();

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());

const VGS_API_URL = process.env.VGS_API_URL || "https://gw-01-sandbox.vgsapi.com";
const VGS_CMP_API_URL = process.env.VGS_CMP_API_URL || "https://sandbox.vgsapi.com";
const VGS_CLIENT_ID = process.env.VGS_CLIENT_ID || "";
const VGS_CLIENT_SECRET = process.env.VGS_CLIENT_SECRET || "";
const VGS_AUTH_URL =
  process.env.VGS_AUTH_URL ||
  "https://auth.verygoodsecurity.com/auth/realms/vgs/protocol/openid-connect/token";
const PORT = process.env.PORT || 3000;

// --- Token management ---

let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt) {
    return accessToken;
  }

  console.log(`→ AUTH ${VGS_AUTH_URL}`);
  const res = await fetch(VGS_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: VGS_CLIENT_ID,
      client_secret: VGS_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  console.log("← Access token obtained, expires in", data.expires_in, "s");
  return accessToken;
}

// --- Proxy helpers ---

async function callApi(baseUrl, method, path, body) {
  const token = await getAccessToken();
  const url = `${baseUrl}${path}`;
  console.log(`→ ${method} ${url}`);
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${token}`,
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  console.log(`← ${res.status} ${text.substring(0, 300)}`);
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  };
}

// --- Routes ---

// GET /api/token — get access token for SDK (device binding calls VGS API from the browser)
app.get("/api/token", handler(async (req, res) => {
  const token = await getAccessToken();
  res.json({ access_token: token });
}));

// POST /api/cards — create a test card (CMP API)
app.post("/api/cards", handler(async (req, res) => {
  const { status, data } = await callApi(VGS_CMP_API_URL, "POST", "/cards", req.body);
  res.status(status).json(data);
}));

// POST /api/cards/:cardId/agentic-tokens — enroll card (Agentic API)
app.post("/api/cards/:cardId/agentic-tokens", handler(async (req, res) => {
  const { status, data } = await callApi(
    VGS_API_URL, "POST",
    `/cards/${req.params.cardId}/agentic-tokens`,
    req.body
  );
  res.status(status).json(data);
}));

// POST /api/intents — create intent (Agentic API)
app.post("/api/intents", handler(async (req, res) => {
  const { tokenId } = req.query;
  const { status, data } = await callApi(
    VGS_API_URL, "POST",
    `/agentic-tokens/${tokenId}/intents`,
    req.body
  );
  res.status(status).json(data);
}));

// PUT /api/intents — update intent (Agentic API)
app.put("/api/intents", handler(async (req, res) => {
  const { tokenId, intentId } = req.query;
  const { status, data } = await callApi(
    VGS_API_URL, "PUT",
    `/agentic-tokens/${tokenId}/intents/${intentId}`,
    req.body
  );
  res.status(status).json(data);
}));

// DELETE /api/intents — cancel intent (Agentic API)
app.delete("/api/intents", handler(async (req, res) => {
  const { tokenId, intentId } = req.query;
  const { status, data } = await callApi(
    VGS_API_URL, "DELETE",
    `/agentic-tokens/${tokenId}/intents/${intentId}`,
    req.body
  );
  res.status(status).json(data);
}));

// POST /api/cryptograms — get payment cryptogram (Agentic API)
app.post("/api/cryptograms", handler(async (req, res) => {
  const { tokenId, intentId } = req.query;
  const { status, data } = await callApi(
    VGS_API_URL, "POST",
    `/agentic-tokens/${tokenId}/intents/${intentId}/cryptograms`,
    req.body
  );
  res.status(status).json(data);
}));

// --- Start ---

app.listen(PORT, () => {
  console.log(`Sample app running on port ${PORT}`);
  console.log(`CMP API:     ${VGS_CMP_API_URL}`);
  console.log(`Agentic API: ${VGS_API_URL}`);
  if (!VGS_CLIENT_ID || !VGS_CLIENT_SECRET) {
    console.warn("WARNING: VGS_CLIENT_ID or VGS_CLIENT_SECRET not set.");
  }
});
