// Shared VGS API client.
// Used by the Express server (Docker) and by Netlify Functions.

const VGS_API_URL = process.env.VGS_API_URL || "https://gw-01-sandbox.vgsapi.com";
const VGS_CMP_API_URL = process.env.VGS_CMP_API_URL || "https://sandbox.vgsapi.com";
const VGS_CLIENT_ID = process.env.VGS_CLIENT_ID || "";
const VGS_CLIENT_SECRET = process.env.VGS_CLIENT_SECRET || "";
const VGS_AUTH_URL =
  process.env.VGS_AUTH_URL ||
  "https://auth.verygoodsecurity.com/auth/realms/vgs/protocol/openid-connect/token";
const VGS_VAULT_ID = process.env.VGS_VAULT_ID || "";
const VGS_VAULT_ENV = process.env.VGS_VAULT_ENV || "sandbox";

export const config = {
  apiUrl: VGS_API_URL,
  cmpApiUrl: VGS_CMP_API_URL,
  vaultId: VGS_VAULT_ID,
  vaultEnv: VGS_VAULT_ENV,
};

let accessToken = null;
let tokenExpiresAt = 0;

export async function getAccessToken() {
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

export async function callVgs(baseUrl, method, path, body) {
  const token = await getAccessToken();
  const url = `${baseUrl}${path}`;
  if (body) {
    console.log(`→ ${method} ${url}\n  body: ${JSON.stringify(body)}`);
  } else {
    console.log(`→ ${method} ${url}`);
  }
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${token}`,
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  console.log(`← ${res.status} ${text.substring(0, 500)}`);
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

export function hasCredentials() {
  return Boolean(VGS_CLIENT_ID && VGS_CLIENT_SECRET);
}
