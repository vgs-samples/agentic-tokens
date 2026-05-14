// Shared helpers for Netlify Functions.

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function wrap(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      const cause = err.cause?.message ?? err.cause?.code;
      console.error(`Error: ${err.message}${cause ? ` | cause: ${cause}` : ""}`);
      return json(500, { error: err.message, cause });
    }
  };
}
