import { useState } from "react";
import { api } from "../api";
import { type StepProps, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Button } from "./ui";

interface Props extends StepProps {
  consumerEmail: string;
  setConsumerEmail: (v: string) => void;
}

export function EnrollToken({ state, setState, log, setLoading, completeStep, consumerEmail, setConsumerEmail }: Props) {
  const [response, setResponse] = useState<unknown>(null);
  const { done, loading, disabled } = useStepStatus(state, 2);

  async function handleEnroll() {
    setLoading(2, true);
    log("Step 2: Enrolling token...");
    try {
      const data = await api("POST", `/cards/${state.cardId}/agentic-tokens`, {
        data: {
          type: "agentic_tokens",
          attributes: { consumer_email: consumerEmail },
        },
      });
      setResponse(data);
      if (data?.data?.id) {
        setState((s) => ({ ...s, tokenId: data.data.id }));
        log(`Step 2: Token enrolled — ${data.data.id}`);
        completeStep(2);
      } else {
        log("Step 2: Failed — " + JSON.stringify(data));
        setLoading(2, false);
      }
    } catch (err) {
      log("Step 2: Error — " + (err as Error).message);
      setLoading(2, false);
    }
  }

  return (
    <Step num={2} title="Enroll Agentic Token" active={state.activeStep === 2} done={done} loading={loading} disabled={disabled} response={response}>
      <Field label="Card ID">
        <input className="input" readOnly value={state.cardId ?? ""} />
      </Field>
      <Field label="Consumer Email">
        <input className="input" value={consumerEmail} onChange={(e) => setConsumerEmail(e.target.value)} />
      </Field>
      <Button onClick={handleEnroll}>Enroll</Button>
    </Step>
  );
}
