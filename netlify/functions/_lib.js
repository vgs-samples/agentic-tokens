// Shared helpers for Netlify Functions.

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// A bad request the handler wants to reject outright; wrap() turns it into that response.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function wrap(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      const cause = err.cause?.message ?? err.cause?.code;
      console.error(`Error: ${err.message}${cause ? ` | cause: ${cause}` : ""}`);
      return json(500, { error: err.message, cause });
    }
  };
}

// Token-scoped routes all take ?tokenId= and are meaningless without it.
export function requireTokenId(url) {
  const tokenId = url.searchParams.get("tokenId");
  if (!tokenId) throw new HttpError(400, "tokenId required");
  return tokenId;
}
