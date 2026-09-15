import { callVgs, config } from "./vgs.js";

// Shared by Express and Netlify; both networks use the same deletion contract.
export async function deleteAgenticToken(network, tokenId) {
  if (network !== "amex" && network !== "mastercard") {
    return { status: 400, data: { error: "Deletion is supported only for Amex and Mastercard" } };
  }
  if (typeof tokenId !== "string" || !tokenId.trim()) {
    return { status: 400, data: { error: "tokenId required" } };
  }
  return callVgs(
    config.apiUrl,
    "DELETE",
    `/temporary/${network}/agentic-tokens/${encodeURIComponent(tokenId.trim())}`,
  );
}
