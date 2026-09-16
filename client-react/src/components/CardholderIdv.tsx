import { useState } from "react";
import { getStepUpOptions, idvErrorInfo, newClientRefId, requestOtp, submitOtp, type OtpMethod } from "../idv";
import { useAppState, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Button } from "./ui";

interface Props {
  consumerEmail: string;
  purpose: "enrollment" | "credential";
}

interface SubmitOtpEnvelope {
  data?: {
    attributes?: {
      status?: string;
      result?: unknown;
    };
  };
  meta?: unknown;
}

/**
 * Cardholder verification over the shared Visa-compatible OTP contract.
 *
 * Read `idv.ts` for the API calls themselves; this component is only the form around them:
 * Visa fetches its options separately. Providers that return challenges with an
 * enrollment or credential response preload the exact same method shape.
 */
export function CardholderIdv({ consumerEmail, purpose }: Props) {
  const { state, setState, log, setLoading, completeStep } = useAppState();
  const isCredentialOtp = purpose === "credential";
  const stepKey = isCredentialOtp ? "credentialOtp" : "idv";
  const context = isCredentialOtp ? state.credentialOtpContext : state.otpContext;
  const { loading, num } = useStepStatus(stepKey);
  const [response, setResponse] = useState<unknown>(null);
  // Visa creates a correlation id before fetching options. Amex returns an opaque
  // provider reference with its already-known challenge methods; callers only echo it.
  const [visaClientRefId, setVisaClientRefId] = useState(() => newClientRefId());
  const [visaMethods, setVisaMethods] = useState<OtpMethod[]>([]);
  const [selectedMethodIdentifier, setSelectedMethodIdentifier] = useState("");
  const [otpDelivered, setOtpDelivered] = useState(false);
  const [otp, setOtp] = useState("");
  const clientRefId = context?.clientRefId ?? visaClientRefId;
  const methods = context?.methods ?? visaMethods;
  const selectedIdentifier = methods.some(({ identifier }) => identifier === selectedMethodIdentifier)
    ? selectedMethodIdentifier
    : methods[0]?.identifier ?? "";

  function fail(err: unknown) {
    const info = idvErrorInfo(err);
    log(`Step ${num}: Error — ${info.error}`);
    setResponse(info);
  }

  async function handleGetOptions() {
    setLoading(stepKey, true);
    log(`Step ${num}: Fetching verification options... clientRefId=${clientRefId}`);
    try {
      const options = await getStepUpOptions(state.tokenId!, clientRefId);
      setResponse(options.raw);
      setVisaMethods(options.methods);
      setSelectedMethodIdentifier(options.methods[0]?.identifier ?? "");
      setOtpDelivered(false);
      log(`Step ${num}: status=${options.status} passkeyRequired=${options.passkeyRequired}`);
      if (options.passkeyRequired) {
        // Shouldn't happen: this step only renders when the enroll response reported
        // cardholder_verification=otp. Worth surfacing if the two ever disagree.
        log(`Step ${num}: Unexpected — step-up options say a passkey is required for this vault`);
      }
      if (!options.methods.length) {
        log(`Step ${num}: No OTP methods offered`);
      }
    } catch (err) {
      fail(err);
    }
    setLoading(stepKey, false);
  }

  async function handleRequestOtp() {
    const method = methods.find((m) => m.identifier === selectedIdentifier);
    if (!method) {
      log(`Step ${num}: Pick a method first`);
      return;
    }
    setLoading(stepKey, true);
    log(`Step ${num}: Requesting code via ${method.method}...`);
    try {
      setResponse(await requestOtp(state.tokenId!, clientRefId, method.identifier));
      setOtpDelivered(true);
      log(`Step ${num}: Code delivery requested`);
    } catch (err) {
      fail(err);
    }
    setLoading(stepKey, false);
  }

  async function handleSubmitOtp() {
    setLoading(stepKey, true);
    log(`Step ${num}: Submitting code...`);
    try {
      const result = await submitOtp(
        state.tokenId!,
        clientRefId,
        consumerEmail,
        otp.trim(),
      ) as SubmitOtpEnvelope;
      setResponse(result);
      const completedCredential = result.data?.attributes?.result;
      if (isCredentialOtp) {
        if (!completedCredential) {
          log(`Step ${num}: OTP was accepted but Amex did not return a payment credential`);
          setLoading(stepKey, false);
          return;
        }
        setState((s) => ({
          ...s,
          cryptogramResponse: {
            data: completedCredential,
            ...(result.meta ? { meta: result.meta } : {}),
          },
        }));
        log(`Step ${num}: Payment credential verified and received`);
        completeStep("cryptogram");
        completeStep("credentialOtp");
        return;
      }

      // ID&V is complete. There is no assurance_data in this flow — make sure any value
      // left over from a passkey run doesn't leak into intent creation.
      setState((s) => ({
        ...s,
        assuranceData: null,
        otpContext: null,
      }));
      log(`Step ${num}: Cardholder verified`);
      completeStep("idv");
    } catch (err) {
      fail(err);
      setLoading(stepKey, false);
    }
  }

  return (
    <Step
      stepKey={stepKey}
      title={isCredentialOtp ? "Payment Credential Verification (OTP)" : "Cardholder Verification (ID&V)"}
      response={response}
    >
      <p className="text-xs text-gray-500">
        {isCredentialOtp
          ? "Amex requested a second step-up for this payment credential. Choose any channel offered for this challenge and enter its code."
          : "Verify the cardholder with a one-time code using the same API contract for Visa and Amex."}{" "}
        All client-side calls are in <code>src/idv.ts</code>.
      </p>
      <Field label="Token ID">
        <input
          className="input"
          value={state.tokenId ?? ""}
          onChange={(e) => setState((s) => ({ ...s, tokenId: e.target.value }))}
        />
      </Field>
      <Field label="Client Reference ID (echoed by all verification calls)">
        <input
          className="input"
          value={clientRefId}
          readOnly={Boolean(context)}
          onChange={(e) => setVisaClientRefId(e.target.value)}
        />
      </Field>
      {context ? (
        <p className="text-xs text-gray-500 mt-2">Verification options were returned by the previous API call.</p>
      ) : (
        <Button onClick={handleGetOptions} disabled={loading}>Get Verification Options</Button>
      )}

      {methods.length > 0 && (
        <>
          <div className="mt-3 flex items-end gap-2">
            <Field label="Method">
              <select
                className="input w-64"
                value={selectedIdentifier}
                onChange={(e) => setSelectedMethodIdentifier(e.target.value)}
              >
                {methods.map((m) => (
                  <option key={m.identifier} value={m.identifier}>
                    {m.value ? `${m.method} — ${m.value}` : m.method}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={handleRequestOtp} disabled={loading || !selectedIdentifier}>
              {otpDelivered ? "Resend Code" : "Send Code"}
            </Button>
          </div>

          {otpDelivered && (
            <div className="mt-3 flex items-end gap-2">
              <Field label="Code">
                <input
                  className="input w-48"
                  maxLength={6}
                  inputMode="numeric"
                  placeholder="Code from SMS or email"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
              </Field>
              <Button onClick={handleSubmitOtp} disabled={loading}>Submit Code</Button>
            </div>
          )}
        </>
      )}
    </Step>
  );
}
