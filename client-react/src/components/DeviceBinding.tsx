import { useRef, useState } from "react";
import { fetchAccessToken } from "../api";
import { useAppState, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

const SANDBOX_OTP = "456789";

interface Props {
  consumerEmail: string;
}

export function DeviceBinding({ consumerEmail }: Props) {
  const { state, setState, log, setLoading, completeStep, sessionRef } = useAppState();
  const { loading, num } = useStepStatus("deviceBinding");
  const [response, setResponse] = useState<unknown>(null);
  const [environment, setEnvironment] = useState(import.meta.env.VITE_DEFAULT_ENVIRONMENT || "sandbox");
  const [authAmount, setAuthAmount] = useState("100");
  const [currencyCode, setCurrencyCode] = useState("840");
  const [merchantName, setMerchantName] = useState("VGS");
  const [otpVisible, setOtpVisible] = useState(false);
  const [otp, setOtp] = useState(SANDBOX_OTP);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [otpMethods, setOtpMethods] = useState<any[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState("");
  const [otpDelivered, setOtpDelivered] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function handleStartSession() {
    setLoading("deviceBinding", true);
    setSessionStarted(true);
    log(`Step ${num}: Starting device binding session...`);
    try {
      const accessToken = await fetchAccessToken();
      const clientRefId = crypto.randomUUID();
      log(`Step ${num}: clientRefId=${clientRefId}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { VgsAgenticAuth }: any = await import("../vgs-agentic-auth.js");
      const flow = new VgsAgenticAuth({
        tokenId: state.tokenId,
        environment,
        consumerEmail,
        accessToken,
        clientRefId,
        authenticationAmount: authAmount,
        currencyCode,
        merchantName,
      });

      // Server-driven flow selection. Try the iframe-free step-up path first: for a
      // passkey-exempt tenant the server returns needsPasskey === false and we skip the
      // Visa iframe / passkey entirely. If the tenant still needs a passkey (or the probe
      // isn't applicable), fall back to the full-FIDO iframe session.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let session: any = null;
      try {
        session = await flow.startStepUpSession();
        if (session.needsPasskey !== false) {
          session.destroy?.();
          session = null;
        } else {
          log(`Step ${num}: passkey-exempt tenant — iframe-free step-up (no passkey)`);
        }
      } catch (probeErr) {
        log(`Step ${num}: step-up-options not usable (${(probeErr as { message: string }).message}); using iframe flow`);
      }
      if (!session) {
        session = await flow.startSession(containerRef.current);
      }
      sessionRef.current = session;
      log(`Step ${num}: Session created. needsOtp=${session.needsOtp} needsPasskey=${session.needsPasskey}`);

      // Full-FIDO only: keep the passkey iframe hidden until the ceremony. (Iframe-free
      // sessions have no iframe.)
      if (session.needsPasskey === false && session.iframe) {
        session.iframe.style.display = "none";
      }

      if (session.needsOtp) {
        setOtpMethods(session.otpMethods);
        setSelectedMethodId(session.otpMethods[0]?.identifier ?? "");
        setOtpDelivered(false);
        setOtpVisible(true);
        setLoading("deviceBinding", false);
      } else {
        await handleAuthenticate(session);
      }
    } catch (err: unknown) {
      const e = err as { message: string; code?: string; status?: number };
      log(`Step ${num}: Session error — ` + e.message);
      setResponse({ error: e.message, code: e.code, status: e.status });
      setSessionStarted(false);
      setLoading("deviceBinding", false);
    }
  }

  async function handleRequestOtp() {
    const method = otpMethods.find((m) => m.identifier === selectedMethodId);
    if (!method) {
      log(`Step ${num}: Pick an OTP method first`);
      return;
    }
    setLoading("deviceBinding", true);
    log(`Step ${num}: Requesting OTP via ${method.method}...`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionRef.current as any;
    try {
      await session.requestOtp(method);
      setOtpDelivered(true);
      log(`Step ${num}: OTP delivery requested`);
      setLoading("deviceBinding", false);
    } catch (err: unknown) {
      const e = err as { message: string; code?: string };
      log(`Step ${num}: requestOtp error — ` + e.message);
      setResponse({ error: e.message, code: e.code });
      setLoading("deviceBinding", false);
    }
  }

  async function handleSubmitOtp() {
    setLoading("deviceBinding", true);
    log(`Step ${num}: Submitting OTP...`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionRef.current as any;
    try {
      await session.submitOtp(otp.trim());
      setOtpVisible(false);
      log(`Step ${num}: OTP accepted`);
      await handleAuthenticate(session);
    } catch (err: unknown) {
      const e = err as { message: string; code?: string };
      log(`Step ${num}: OTP error — ` + e.message);
      setResponse({ error: e.message, code: e.code });
      setLoading("deviceBinding", false);
    }
  }

  function handleSkip() {
    log(`Step ${num}: Skipped — passkey-exempt tenant; backend synthesizes the assurance waiver`);
    const session = sessionRef.current as { destroy?: () => void } | null;
    if (session?.destroy) session.destroy();
    sessionRef.current = null;
    setState((s) => ({ ...s, assuranceData: null }));
    setResponse({ skipped: true, note: "Device binding bypassed (passkey-exempt)" });
    completeStep("deviceBinding");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function handleAuthenticate(sessionArg?: any) {
    setLoading("deviceBinding", true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionArg ?? (sessionRef.current as any);
    if (session.needsPasskey === false) {
      // Passkey-exempt: no ceremony, no iframe. authenticate() resolves immediately and
      // the backend synthesizes the assuranceData waiver.
      log(`Step ${num}: Passkey exempt — skipping passkey ceremony (backend synthesizes the waiver)`);
    } else {
      // Full FIDO: reveal the iframe for the passkey/biometric prompt.
      if (session.iframe) {
        session.iframe.style.display = "block";
      }
      log(`Step ${num}: Running FIDO ceremony...`);
    }
    try {
      const assuranceData = await session.authenticate();
      session.destroy();
      sessionRef.current = null;
      setState((s) => ({ ...s, assuranceData }));
      setResponse({ assuranceData });
      log(`Step ${num}: Device binding complete`);
      completeStep("deviceBinding");
    } catch (err: unknown) {
      const e = err as { message: string; code?: string };
      log(`Step ${num}: FIDO error — ` + e.message);
      setResponse({ error: e.message, code: e.code });
      setLoading("deviceBinding", false);
    }
  }

  return (
    <Step stepKey="deviceBinding" title="Device Binding (FIDO / OTP)" response={response}>
      <Field label="Token ID">
        <input className="input" value={state.tokenId ?? ""} onChange={(e) => setState((s) => ({ ...s, tokenId: e.target.value }))} />
      </Field>
      <Field label="Environment">
        <select className="input" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
          <option value="local">Local</option>
          <option value="dev">Dev</option>
          <option value="sandbox">Sandbox</option>
          <option value="live">Live</option>
        </select>
      </Field>
      <Row>
        <Field label="Authentication Amount">
          <input className="input" value={authAmount} onChange={(e) => setAuthAmount(e.target.value)} />
        </Field>
        <Field label="Currency Code">
          <select className="input" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
            <option value="840">840 — USD</option>
            <option value="978">978 — EUR</option>
            <option value="826">826 — GBP</option>
            <option value="392">392 — JPY</option>
            <option value="036">036 — AUD</option>
            <option value="124">124 — CAD</option>
          </select>
        </Field>
      </Row>
      <Field label="Merchant Name (optional)">
        <input className="input" placeholder="e.g. Best Buy" value={merchantName} onChange={(e) => setMerchantName(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button onClick={handleStartSession} disabled={sessionStarted || loading}>Start Session</Button>
        <Button onClick={handleSkip} disabled={loading} variant="secondary">Skip — manual override</Button>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        The flow is <strong>server-driven</strong>: Start Session reads <code>needsOtp</code> / <code>needsPasskey</code>
        from the device-attestation response. A passkey-exempt tenant
        (<code>visa_fido_mode: passkey_exempt</code> or <code>passkey_exempt_idv</code>) skips the passkey
        automatically — OTP still shows for <code>passkey_exempt_idv</code>. Skip is only a manual override.
      </p>

      {otpVisible && (
        <>
          <div className="mt-3 flex items-end gap-2">
            <Field label="OTP Method">
              <select
                className="input w-48"
                value={selectedMethodId}
                onChange={(e) => setSelectedMethodId(e.target.value)}
              >
                {otpMethods.map((m) => (
                  <option key={m.identifier} value={m.identifier}>
                    {m.method}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={handleRequestOtp} disabled={loading || !selectedMethodId}>
              {otpDelivered ? "Resend OTP" : "Send OTP"}
            </Button>
          </div>

          {otpDelivered && (
            <div className="mt-3 flex items-end gap-2">
              <Field label="OTP Code">
                <input className="input w-48" maxLength={6} placeholder={SANDBOX_OTP} value={otp} onChange={(e) => setOtp(e.target.value)} />
              </Field>
              <Button onClick={handleSubmitOtp} disabled={loading}>Submit OTP</Button>
            </div>
          )}
        </>
      )}

      <div ref={containerRef} className="mt-3" />
    </Step>
  );
}
