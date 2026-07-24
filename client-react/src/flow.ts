/**
 * Per-network configuration for the demo. This file is the single place that
 * knows how each card network behaves — adding a network (e.g. amex, discover)
 * is a matter of extending the `Record<Network, …>` tables below, and TypeScript
 * will flag every table that's still missing an entry. Components must consume
 * these tables / helpers rather than testing `network === "visa"` directly.
 */

/** Card networks the demo supports. */
export type Network = "visa" | "mastercard" | "amex";

/** Stable identifier for each step, independent of its position in a flow. */
export type StepKey = "card" | "enroll" | "deviceBinding" | "intent" | "cryptogram" | "confirm";

/**
 * The ordered steps for each network's flow. The displayed step number and the
 * gating order are derived from these lists — Visa runs the full sequence, while
 * Mastercard SCOF and Amex ACE skip device binding, intent, and confirmation.
 */
export const FLOWS: Record<Network, StepKey[]> = {
  visa: ["card", "enroll", "deviceBinding", "intent", "cryptogram", "confirm"],
  mastercard: ["card", "enroll", "cryptogram"],
  amex: ["card", "enroll", "cryptogram"],
};

/**
 * How a network's cryptogram is requested, decoupled from the network name:
 *  - "intent" — intent-scoped, with a transaction-data cart (Visa).
 *  - "scof"   — card-scoped SCOF checkout, no intent (Mastercard).
 *  - "amex"   — card-scoped Amex ACE payment credentials, no intent.
 * Mastercard and Amex now share the same public URL; the style still controls
 * the form fields and payload attributes.
 * A new network maps onto one of these styles (or adds a new one, which the
 * `Record<Network, …>` makes TypeScript surface in GetCryptogram).
 */
export type CryptogramStyle = "intent" | "scof" | "amex";
export const CRYPTOGRAM_STYLE: Record<Network, CryptogramStyle> = {
  visa: "intent",
  mastercard: "scof",
  amex: "amex",
};

/** Display metadata for a network — label and Tailwind badge classes. */
export interface NetworkMeta {
  label: string;
  badgeCss: string;
}
export const NETWORK_META: Record<Network, NetworkMeta> = {
  visa: { label: "Visa", badgeCss: "bg-blue-100 text-blue-800" },
  mastercard: { label: "Mastercard · SCOF", badgeCss: "bg-orange-100 text-orange-800" },
  amex: { label: "Amex · ACE", badgeCss: "bg-sky-100 text-sky-800" },
};

/** The network assumed before any detection has run. */
export const DEFAULT_NETWORK: Network = "visa";

/**
 * Map a Collect.js `cardType` string to a Network. Collect reports the brand it
 * detects from the typed PAN; we use it to resolve the network for custom cards
 * entered in the secure iframe. Returns null for brands we don't model yet.
 */
const COLLECT_CARD_TYPES: Record<string, Network> = {
  visa: "visa",
  mastercard: "mastercard",
  "master card": "mastercard",
  amex: "amex",
  "american express": "amex",
  americanexpress: "amex",
  "american-express": "amex",
};
export function networkFromCardType(cardType: string | null | undefined): Network | null {
  return cardType ? COLLECT_CARD_TYPES[cardType.trim().toLowerCase()] ?? null : null;
}

/**
 * Authoritatively reconcile the network from an enroll response, falling back to
 * the PAN-detected `fallback` when the response carries no network-specific
 * marker. Mastercard's SCOF branch returns `enrollment.digital_card_id`; Visa
 * does not. New networks add their own marker check here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reconcileNetwork(enrollResponse: any, fallback: Network): Network {
  if (enrollResponse?.data?.attributes?.enrollment?.digital_card_id) return "mastercard";
  if (enrollResponse?.data?.attributes?.enrollment?.network === "amex") return "amex";
  return fallback;
}
