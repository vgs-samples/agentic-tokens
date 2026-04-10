export async function api(method: string, path: string, body?: object) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

export async function fetchAccessToken(): Promise<string> {
  const res = await fetch("/api/token");
  const data = await res.json();
  return data.access_token;
}
