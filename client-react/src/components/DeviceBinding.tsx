import { useEffect, useRef, useState } from "react";
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
  const verificationRef = useRef<AbortController | null>(null);
  const challengeRef = useRef<{ resolve: () => void } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      verificationRef.current?.abort();
      if (verificationRef.current) setLoading("deviceBinding", false);
      const session = sessionRef.current as { destroy?: () => void } | null;
      session?.destroy?.();
      sessionRef.current = null;
    };
  }, [sessionRef, setLoading]);

  async function handleStartSession() {
    if (verificationRef.current) return;
    const controller = new AbortController();
    verificationRef.current = controller;
    setLoading("deviceBinding", true);
    setSessionStarted(true);
    log(`Step ${num}: Starting cardholder verification...`);
    try {
      const accessToken = await fetchAccessToken();
      const clientRefId = state.otpContext?.clientRefId ?? crypto.randomUUID();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { VgsAgenticAuth }: any = await import("../vgs-agentic-auth.js");
      const flow = new VgsAgenticAuth({
        tokenId: state.tokenId, environment, consumerEmail, accessToken, clientRefId,
        authenticationAmount: authAmount, currencyCode, merchantName,
      });
      const { assuranceData } = await flow.verify({
        container: containerRef.current,
        signal: controller.signal,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSession: (session: any) => {
          sessionRef.current = session;
          if (session.needsPasskey === false) session.iframe.style.display = "none";
        },
        // The SDK pauses for the application's OTP form, then resumes browser verification.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChallenge: (session: any) => {
          setOtpMethods(session.otpMethods);
          setSelectedMethodId(session.otpMethods[0]?.identifier ?? "");
          setOtpDelivered(false);
          setOtpVisible(true);
          setLoading("deviceBinding", false);
          return new Promise<void>((resolve) => { challengeRef.current = { resolve }; });
        },
      });
      if (!mounted.current) return;
      setState((s) => ({ ...s, assuranceData }));
      setResponse({ assuranceData });
      log(`Step ${num}: Cardholder verification complete`);
      completeStep("deviceBinding");
    } catch (err: unknown) {
      if (!mounted.current) return;
      const e = err as { message: string; code?: string; status?: number };
      log(`Step ${num}: Verification error — ${e.message}`);
      setResponse({ error: e.message, code: e.code, status: e.status });
      setSessionStarted(false);
      setOtpVisible(false);
    } finally {
      sessionRef.current = null;
      challengeRef.current = null;
      verificationRef.current = null;
      if (mounted.current) setLoading("deviceBinding", false);
    }
  }

  async function handleRequestOtp() {
    const method = otpMethods.find((m) => m.identifier === selectedMethodId);
    if (!method) return;
    setLoading("deviceBinding", true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionRef.current as any;
    try {
      await session.requestOtp(method);
      if (!mounted.current) return;
      setOtpDelivered(true);
      log(`Step ${num}: OTP delivery requested`);
    } catch (err: unknown) {
      if (!mounted.current) return;
      const e = err as { message: string; code?: string };
      setResponse({ error: e.message, code: e.code });
    } finally { if (mounted.current) setLoading("deviceBinding", false); }
  }

  async function handleSubmitOtp() {
    setLoading("deviceBinding", true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionRef.current as any;
    try {
      await session.submitOtp(otp.trim());
      if (!mounted.current) return;
      setOtpVisible(false);
      log(`Step ${num}: OTP accepted; continuing verification...`);
      challengeRef.current?.resolve();
    } catch (err: unknown) {
      if (!mounted.current) return;
      const e = err as { message: string; code?: string };
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
      <Button onClick={handleStartSession} disabled={sessionStarted || loading}>Start Session</Button>
      <p className="text-xs text-gray-500 mt-1">
        The library reads <code>needsOtp</code> / <code>needsPasskey</code> from the device-attestation
        response, so the server decides which prompts run. Vaults that verify with a one-time code
        instead of a passkey use the <strong>Cardholder ID&amp;V</strong> mode in the header.
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
