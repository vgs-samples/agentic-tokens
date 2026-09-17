import { apiResponse } from "./api.ts";

/** ACE 1.1 additions to the shared enrollment and checkout contracts. */
export interface AgentContext {
  agent_name: string;
  llm_platform?: "OPEN_AI";
  llm_version?: string;
}

export interface EnrollmentContext {
  consumerId?: string;
  firstName: string;
  lastName: string;
  deviceId: string;
  ipAddress: string;
  language: string;
  formFactor: string;
  browserUserAgent: string;
  distinctBillingLastNameCount: string;
  agent: AgentContext;
}

// ACE-OAI-1.1_v6.yaml: decryptedEnrollmentRequestPayload example.
// The example's AI_PLATFORM is not in the schema enum; leave the optional platform
// unset here so checkout can collect a supported platform explicitly.
export const AMEX_ENROLLMENT_EXAMPLE: Omit<EnrollmentContext, "language" | "browserUserAgent"> = {
  consumerId: "user-12345",
  firstName: "Jane",
  lastName: "Jones",
  deviceId: "565266",
  ipAddress: "192.168.1.1",
  formFactor: "MOBILE",
  distinctBillingLastNameCount: "2",
  agent: { agent_name: "NexusAI", llm_version: "gpt-4.1" },
};

export function enrollmentAttributes(consumerEmail: string, context?: EnrollmentContext) {
  if (!context) return { consumer_email: consumerEmail };
  const required = [context.firstName, context.lastName, context.deviceId, context.ipAddress,
    context.language, context.formFactor, context.agent.agent_name];
  if (required.some((value) => !value.trim()) || !/^\d+$/.test(context.distinctBillingLastNameCount)) {
    throw new Error("Fill in cardholder, device, agent and account risk details before enrolling.");
  }
  return {
    consumer_email: consumerEmail,
    ...(context.consumerId?.trim() ? { consumer_id: context.consumerId.trim() } : {}),
    consumer_first_name: context.firstName.trim(), consumer_last_name: context.lastName.trim(),
    device_id: context.deviceId,
    agents: [context.agent],
    browser_data: { ipAddress: context.ipAddress.trim(), browserLanguage: context.language, userAgent: context.browserUserAgent },
    risk: {
      account: { action_channel: "WEB", fpan_source: "ONFILE",
        distinct_billing_last_name_count: context.distinctBillingLastNameCount },
      device: { form_factor: context.formFactor },
    },
  };
}

export interface PaymentChallenge {
  clientRefId: string;
  methods: Array<{ method: string; identifier: string; value?: string }>;
}

// Demo prefill from ACE 1.1; Maranui never supplies an example postal code.
export const AMEX_BILLING_POSTAL_CODE_EXAMPLE = "12345";

export function paymentBillingAttributes(postalCode: string) {
  const zip = postalCode.trim();
  return zip ? { billing_address: { zip } } : {};
}

export type PaymentDeviceContext = Pick<EnrollmentContext,
  "deviceId" | "ipAddress" | "language" | "formFactor" | "browserUserAgent">;

export function paymentRiskAttributes(context: PaymentDeviceContext) {
  if ([context.deviceId, context.ipAddress, context.language, context.formFactor].some((value) => !value.trim())) {
    throw new Error("Provide device ID, IP address, language and form factor before requesting a credential.");
  }
  return {
    device_id: context.deviceId,
    browser_data: {
      ipAddress: context.ipAddress.trim(), browserLanguage: context.language, userAgent: context.browserUserAgent,
    },
    risk: { account: { action_channel: "WEB" }, device: { form_factor: context.formFactor } },
  };
}

export function paymentOutcome(body: unknown): { challenge?: PaymentChallenge; credential?: Record<string, unknown> } {
  const value = body as { data?: { attributes?: Record<string, unknown> } };
  const attrs = value?.data?.attributes;
  if (attrs?.status === "PENDING_STEP_UP") {
    const methods = attrs.stepUpRequest as PaymentChallenge["methods"];
    if (typeof attrs.client_ref_id !== "string" || !Array.isArray(methods) || !methods.length) {
      throw new Error("Payment verification response is incomplete.");
    }
    return { challenge: { clientRefId: attrs.client_ref_id, methods } };
  }
  if (attrs?.cryptogram && attrs.network_token) return { credential: attrs };
  throw new Error("The response did not include a payment credential.");
}

export interface EnrollmentDeletionBody {
  data?: { id?: string; attributes?: { status?: string } };
  error?: string;
  detail?: string;
}

export function deleteAmexEnrollment(enrollmentId: string) {
  const id = enrollmentId.trim();
  if (!id) throw new Error("Enter an enrollment ID to delete.");
  return apiResponse<EnrollmentDeletionBody>("DELETE", `/amex-enrollments?enrollmentId=${encodeURIComponent(id)}`);
}

export function isEnrollmentAlreadyExists(status: number, body: unknown): boolean {
  return status === 409 && typeof body === "object" && body !== null
    && "detail" in body && body.detail === "Enrollment already exists.";
}
