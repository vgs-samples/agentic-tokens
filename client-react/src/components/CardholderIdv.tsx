import { useState } from "react";
import { getStepUpOptions, idvErrorInfo, newClientRefId, requestOtp, submitOtp, type OtpMethod } from "../idv";
import { useAppState, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Button } from "./ui";

const SANDBOX_OTP = "456789";

interface Props {
  consumerEmail: string;
}

/**
 * Cardholder verification for passkey-exempt vaults — the UI over `src/idv.ts`.
 *
 * Read `idv.ts` for the API calls themselves; this component is only the form around them:
 * fetch the options, pick a method, send the code, submit it. No iframe, no passkey, and
 * nothing to carry into intent creation.
 */
export function CardholderIdv({ consumerEmail }: Props) {
  const { state, setState, log, setLoading, completeStep } = useAppState();
  const { loading, num } = useStepStatus("idv");
  const [response, setResponse] = useState<unknown>(null);
  // One correlation id per verification attempt, shared by all three calls.
  const [clientRefId, setClientRefId] = useState(() => newClientRefId());
  const [methods, setMethods] = useState<OtpMethod[]>([]);
  const [selectedIdentifier, setSelectedIdentifier] = useState("");
  const [otpDelivered, setOtpDelivered] = useState(false);
  const [otp, setOtp] = useState(SANDBOX_OTP);

  function fail(err: unknown) {
    const info = idvErrorInfo(err);
    log(`Step ${num}: Error — ${info.error}`);
    setResponse(info);
  }

  async function handleGetOptions() {
    setLoading("idv", true);
    log(`Step ${num}: Fetching verification options... clientRefId=${clientRefId}`);
    try {
      const options = await getStepUpOptions(state.tokenId!, clientRefId);
      setResponse(options.raw);
      setMethods(options.methods);
      setSelectedIdentifier(options.methods[0]?.identifier ?? "");
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
    setLoading("idv", false);
  }

  async function handleRequestOtp() {
    const method = methods.find((m) => m.identifier === selectedIdentifier);
    if (!method) {
      log(`Step ${num}: Pick a method first`);
      return;
    }
    setLoading("idv", true);
    log(`Step ${num}: Requesting code via ${method.method}...`);
    try {
      setResponse(await requestOtp(state.tokenId!, clientRefId, method.identifier));
      setOtpDelivered(true);
      log(`Step ${num}: Code delivery requested`);
    } catch (err) {
      fail(err);
    }
    setLoading("idv", false);
  }

  async function handleSubmitOtp() {
    setLoading("idv", true);
    log(`Step ${num}: Submitting code...`);
    try {
      setResponse(await submitOtp(state.tokenId!, clientRefId, consumerEmail, otp.trim()));
      // ID&V is complete. There is no assurance_data in this flow — make sure any value
      // left over from a passkey run doesn't leak into intent creation.
      setState((s) => ({ ...s, assuranceData: null }));
      log(`Step ${num}: Cardholder verified`);
      completeStep("idv");
    } catch (err) {
      fail(err);
      setLoading("idv", false);
    }
  }

  return (
    <Step stepKey="idv" title="Cardholder Verification (ID&V)" response={response}>
      <p className="text-xs text-gray-500">
        Passkey-exempt vaults verify the cardholder with a one-time code — no iframe and no
        passkey. All the client-side code for this step is in <code>src/idv.ts</code>.
      </p>
      <Field label="Token ID">
        <input
          className="input"
          value={state.tokenId ?? ""}
          onChange={(e) => setState((s) => ({ ...s, tokenId: e.target.value }))}
        />
      </Field>
      <Field label="Client Reference ID (shared by all verification calls)">
        <input className="input" value={clientRefId} onChange={(e) => setClientRefId(e.target.value)} />
      </Field>
      <Button onClick={handleGetOptions} disabled={loading}>Get Verification Options</Button>

      {methods.length > 0 && (
        <>
          <div className="mt-3 flex items-end gap-2">
            <Field label="Method">
              <select
                className="input w-64"
                value={selectedIdentifier}
                onChange={(e) => setSelectedIdentifier(e.target.value)}
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
                  placeholder={SANDBOX_OTP}
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
