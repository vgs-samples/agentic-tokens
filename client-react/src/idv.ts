/**
 * Visa cardholder ID&V flow (passkey-exempt vaults) — everything the browser does.
 *
 * This is the whole client side of the ID&V flow, deliberately kept in one file with no
 * dependency on the VGS auth library. There is no iframe, no passkey ceremony, and no
 * `assurance_data` to collect: verification is four plain JSON calls.
 *
 *   1. getStepUpOptions()   — which verification methods does the cardholder have?
 *   2. requestOtp()         — send the code via the chosen method
 *   3. submitOtp()          — verify the code (this completes ID&V)
 *   4. completeEnrollment() — finish enrolling the token, now that ID&V passed
 *
 * Order matters: the token cannot create intents until completeEnrollment() succeeds, and
 * completeEnrollment() must come after submitOtp().
 *
 * Every call goes to *this app's own backend* (`/api/...`), which forwards it to the VGS
 * API with server-side credentials — see `server/server.js`. Keep it that way in your own
 * integration: the browser never needs VGS credentials for this flow.
 *
 * The `clientRefId` ties steps 1–3 together. Generate it once per verification attempt
 * (`newClientRefId()`) and pass the same value to all three.
 *
 * Contrast with the passkey flow (`vgs-agentic-auth.js` + `DeviceBinding.tsx`), where the
 * library manages a Visa iframe and returns `assuranceData` for intent creation.
 */

/** One verification method offered for the token. */
export interface OtpMethod {
  /** e.g. "OTPSMS", "OTPEMAIL". */
  method: string;
  /** Opaque id — pass it to requestOtp(). */
  identifier: string;
  /** Masked destination, safe to show the cardholder (e.g. "**PSMS"). */
  value?: string;
}

/** Result of step 1. */
export interface StepUpOptions {
  /** Visa's step-up status, typically "CHALLENGE". */
  status?: string;
  /**
   * Whether the FIDO passkey ceremony is required. `false` confirms the vault is on the
   * ID&V flow. If you ever see `true` here, the vault is configured for the passkey flow
   * and you should use the library instead.
   */
  passkeyRequired: boolean;
  /** Offered methods, filtered to real OTP methods (see isOtpMethod). */
  methods: OtpMethod[];
  /** Raw response, for display/debugging. */
  raw: unknown;
}

/** Error carrying the API's status and error code, so callers can branch on them. */
export class IdvError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, opts: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "IdvError";
    this.status = opts.status;
    this.code = opts.code;
  }
}

/**
 * Narrow a caught value to the fields worth showing the user. Every call below throws
 * `IdvError`, so this is where callers turn a `catch (err: unknown)` back into the status and
 * error code the API reported.
 */
export function idvErrorInfo(err: unknown): { error: string; code?: string; status?: number } {
  if (err instanceof IdvError) return { error: err.message, code: err.code, status: err.status };
  return { error: err instanceof Error ? err.message : String(err) };
}

/** A fresh correlation id for one verification attempt (steps 1–3 share it). */
export function newClientRefId(): string {
  return crypto.randomUUID();
}

/**
 * Keep only methods you can actually deliver a code with. The card network may include
 * placeholder or non-OTP entries (the sandbox returns one), so filter rather than
 * assuming a fixed set or trusting the order.
 */
export function isOtpMethod(m: OtpMethod): boolean {
  return typeof m.method === "string" && m.method.startsWith("OTP");
}

/** Call this app's backend, which proxies to the VGS API. */
async function call<T = unknown>(method: string, path: string, body?: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new IdvError(`Network error: ${(err as Error).message}`);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // The VGS error envelope is { error, detail, meta: { observability: { trace_id … } } }.
    // Quote trace_id to VGS support when something fails upstream.
    const envelope = data as { error?: string; detail?: string } | null;
    throw new IdvError(envelope?.detail || envelope?.error || res.statusText, {
      status: res.status,
      code: envelope?.error,
    });
  }
  return data as T;
}

/**
 * Step 1 — GET /agentic-tokens/{tokenId}/step-up-options
 *
 * Ask which verification methods the cardholder has. Show the masked `value` of each
 * method and keep the `identifier` of the one they pick.
 */
export async function getStepUpOptions(tokenId: string, clientRefId: string): Promise<StepUpOptions> {
  const query = new URLSearchParams({ tokenId, clientRefId });
  const data = await call<{
    data?: { attributes?: { status?: string; passkey_required?: boolean; stepUpRequest?: OtpMethod[] } };
  }>("GET", `/step-up-options?${query}`);

  const attrs = data?.data?.attributes ?? {};
  return {
    status: attrs.status,
    // Absent means "run the passkey" — only an explicit false is the ID&V flow.
    passkeyRequired: attrs.passkey_required !== false,
    methods: (attrs.stepUpRequest ?? []).filter(isOtpMethod),
    raw: data,
  };
}

/**
 * Step 2 — POST /agentic-tokens/{tokenId}/otp/{identifier}
 *
 * Ask the network to deliver a code via the chosen method. Call again to resend.
 */
export async function requestOtp(tokenId: string, clientRefId: string, identifier: string): Promise<unknown> {
  return call("POST", `/otp/${encodeURIComponent(identifier)}?tokenId=${encodeURIComponent(tokenId)}`, {
    data: {
      type: "otp_methods",
      attributes: { client_ref_id: clientRefId },
    },
  });
}

/**
 * Step 3 — POST /agentic-tokens/{tokenId}/otp
 *
 * Verify the code. Success here means cardholder ID&V is complete — there is no follow-up
 * ceremony and no `authenticationContext` to act on.
 *
 * `session_context` / `browser_data` are required by the endpoint but empty in this flow:
 * they exist to carry data collected by the passkey flow's iframe, which we don't have.
 */
export async function submitOtp(
  tokenId: string,
  clientRefId: string,
  consumerEmail: string,
  otp: string,
): Promise<unknown> {
  return call("POST", `/otp?tokenId=${encodeURIComponent(tokenId)}`, {
    data: {
      type: "otp_submissions",
      attributes: {
        otp,
        client_ref_id: clientRefId,
        consumer_email: consumerEmail,
        session_context: {},
        browser_data: {},
      },
    },
  });
}

/**
 * Step 4 — POST /agentic-tokens/{tokenId}/agentic-enrollments
 *
 * Finish enrolling the token now that the cardholder is verified. Call once per token,
 * after submitOtp() and before creating any intent. Use the same `consumer_email` you
 * enrolled the card with.
 */
export async function completeEnrollment(tokenId: string, consumerEmail: string): Promise<unknown> {
  return call("POST", `/agentic-enrollments?tokenId=${encodeURIComponent(tokenId)}`, {
    data: {
      type: "agentic_enrollments",
      attributes: { consumer_email: consumerEmail },
    },
  });
}
