import express from "express";
import { config as loadEnv } from "dotenv";
import { config as vgsConfig, callVgs, getAccessToken, hasCredentials } from "./vgs.js";

loadEnv();

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());

const PORT = process.env.PORT || 3000;

function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const cause = err.cause ? ` | cause: ${err.cause.code ?? err.cause.message ?? err.cause}` : "";
      console.error(`Error: ${err.message}${cause}`);
      res.status(500).json({ error: err.message, cause: err.cause?.message ?? err.cause?.code });
    }
  };
}

// --- Routes ---

// GET /api/token — get access token for SDK (device binding calls VGS API from the browser)
app.get("/api/token", handler(async (req, res) => {
  const token = await getAccessToken();
  res.json({ access_token: token });
}));

// GET /api/config — runtime config for the browser (vault id, environment)
// Keeps client builds env-agnostic: no Vite rebuild required when the vault changes.
app.get("/api/config", (req, res) => {
  res.json({ vaultId: vgsConfig.vaultId, vaultEnv: vgsConfig.vaultEnv });
});

// NOTE: Step 1 (create card) now lives entirely in the browser via VGS Collect.js.
// The PAN never touches this server, so there is no POST /api/cards proxy here.

// POST /api/cards/:cardId/agentic-tokens — enroll card (Agentic API)
app.post("/api/cards/:cardId/agentic-tokens", handler(async (req, res) => {
  const { status, data } = await callVgs(
    vgsConfig.apiUrl, "POST",
    `/cards/${req.params.cardId}/agentic-tokens`,
    req.body
  );
  res.status(status).json(data);
}));

// POST /api/intents — create intent (Agentic API)
app.post("/api/intents", handler(async (req, res) => {
  const { tokenId } = req.query;
  const { status, data } = await callVgs(
    vgsConfig.apiUrl, "POST",
    `/agentic-tokens/${tokenId}/intents`,
    req.body
  );
  res.status(status).json(data);
}));

// PUT /api/intents — update intent (Agentic API)
app.put("/api/intents", handler(async (req, res) => {
  const { tokenId, intentId } = req.query;
  const { status, data } = await callVgs(
    vgsConfig.apiUrl, "PUT",
    `/agentic-tokens/${tokenId}/intents/${intentId}`,
    req.body
  );
  res.status(status).json(data);
}));

// DELETE /api/intents — cancel intent (Agentic API)
app.delete("/api/intents", handler(async (req, res) => {
  const { tokenId, intentId } = req.query;
  const { status, data } = await callVgs(
    vgsConfig.apiUrl, "DELETE",
    `/agentic-tokens/${tokenId}/intents/${intentId}`,
    req.body
  );
  res.status(status).json(data);
}));

// POST /api/cryptograms — get payment cryptogram (Agentic API)
app.post("/api/cryptograms", handler(async (req, res) => {
  const { tokenId, intentId } = req.query;
  const { status, data } = await callVgs(
    vgsConfig.apiUrl, "POST",
    `/agentic-tokens/${tokenId}/intents/${intentId}/cryptograms`,
    req.body
  );
  res.status(status).json(data);
}));

// POST /api/confirmations — confirm transaction outcome (Agentic API)
app.post("/api/confirmations", handler(async (req, res) => {
  const { tokenId, intentId } = req.query;
  const { status, data } = await callVgs(
    vgsConfig.apiUrl, "POST",
    `/agentic-tokens/${tokenId}/intents/${intentId}/confirmations`,
    req.body
  );
  res.status(status).json(data);
}));

// --- Start ---

app.listen(PORT, () => {
  console.log(`Sample app running on port ${PORT}`);
  console.log(`CMP API:     ${vgsConfig.cmpApiUrl}`);
  console.log(`Agentic API: ${vgsConfig.apiUrl}`);
  if (!hasCredentials()) {
    console.warn("WARNING: VGS_CLIENT_ID or VGS_CLIENT_SECRET not set.");
  }
});
