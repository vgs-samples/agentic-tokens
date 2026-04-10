import { useRef, useState } from "react";
import { fetchAccessToken } from "../api";
import { type StepProps, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Button } from "./ui";

interface Props extends StepProps {
  consumerEmail: string;
  sessionRef: React.RefObject<unknown>;
}

export function DeviceBinding({ state, setState, log, setLoading, completeStep, consumerEmail, sessionRef }: Props) {
  const [response, setResponse] = useState<unknown>(null);
  const [environment, setEnvironment] = useState("local");
  const [otpVisible, setOtpVisible] = useState(false);
  const [otp, setOtp] = useState("");
  const [sessionStarted, setSessionStarted] = useState(false);
  const [authVisible, setAuthVisible] = useState(false);
  const [authDisabled, setAuthDisabled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { done, loading, disabled } = useStepStatus(state, 3);

  async function handleStartSession() {
    setLoading(3, true);
    setSessionStarted(true);
    log("Step 3: Starting device binding session...");
    try {
      const accessToken = await fetchAccessToken();
      const clientRefId = crypto.randomUUID();
      log(`Step 3: clientRefId=${clientRefId}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { VgsAgenticAuth }: any = await import("../vgs-agentic-auth.js");
      const flow = new VgsAgenticAuth({
        tokenId: state.tokenId,
        environment,
        consumerEmail,
        accessToken,
        clientRefId,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session: any = await flow.startSession(containerRef.current);
      sessionRef.current = session;
      log("Step 3: Session created. needsOtp=" + session.needsOtp);

      if (session.needsOtp) {
        setOtpVisible(true);
      } else {
        showAuth(session);
      }
      setLoading(3, false);
    } catch (err: unknown) {
      const e = err as { message: string; code?: string; status?: number };
      log("Step 3: Session error — " + e.message);
      setResponse({ error: e.message, code: e.code, status: e.status });
      setSessionStarted(false);
      setLoading(3, false);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function showAuth(session: any) {
    setAuthVisible(true);
    if (session?.iframe) {
      session.iframe.width = 300;
      session.iframe.height = 400;
    }
  }

  async function handleSubmitOtp() {
    setLoading(3, true);
    log("Step 3: Submitting OTP...");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionRef.current as any;
    try {
      await session.submitOtp(otp.trim());
      setOtpVisible(false);
      log("Step 3: OTP accepted");
      showAuth(session);
      setLoading(3, false);
    } catch (err: unknown) {
      const e = err as { message: string; code?: string };
      log("Step 3: OTP error — " + e.message);
      setResponse({ error: e.message, code: e.code });
      setLoading(3, false);
    }
  }

  async function handleAuthenticate() {
    setLoading(3, true);
    setAuthDisabled(true);
    log("Step 3: Running FIDO ceremony...");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionRef.current as any;
    try {
      const assuranceData = await session.authenticate();
      session.destroy();
      sessionRef.current = null;
      setState((s) => ({ ...s, assuranceData }));
      setResponse({ assuranceData });
      log("Step 3: Device binding complete");
      completeStep(3);
    } catch (err: unknown) {
      const e = err as { message: string; code?: string };
      log("Step 3: FIDO error — " + e.message);
      setResponse({ error: e.message, code: e.code });
      setAuthDisabled(false);
      setLoading(3, false);
    }
  }

  return (
    <Step num={3} title="Device Binding (FIDO / OTP)" active={state.activeStep === 3} done={done} loading={loading} disabled={disabled} response={response}>
      <Field label="Token ID">
        <input className="input" readOnly value={state.tokenId ?? ""} />
      </Field>
      <Field label="Environment">
        <select className="input" value={environment} onChange={(e) => setEnvironment(e.target.value)}>
          <option value="local">Local</option>
          <option value="sandbox">Sandbox</option>
        </select>
      </Field>
      <Button onClick={handleStartSession} disabled={sessionStarted}>Start Session</Button>

      {otpVisible && (
        <div className="mt-3 flex items-end gap-2">
          <Field label="OTP Code">
            <input className="input w-48" maxLength={6} placeholder="123456" value={otp} onChange={(e) => setOtp(e.target.value)} />
          </Field>
          <Button onClick={handleSubmitOtp}>Submit OTP</Button>
        </div>
      )}

      {authVisible && (
        <Button onClick={handleAuthenticate} disabled={authDisabled}>Authenticate (FIDO)</Button>
      )}

      <div ref={containerRef} className="mt-3" />
    </Step>
  );
}
