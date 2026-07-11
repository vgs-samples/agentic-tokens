import { useState } from "react";
import { apiResponse } from "../api";
import { useAppState, useStepStatus } from "../useAppState";
import { reconcileNetwork } from "../flow";
import { Step } from "./Step";
import { Field, Button } from "./ui";

interface Props {
  consumerEmail: string;
  setConsumerEmail: (v: string) => void;
}

interface EnrollApiBody {
  data?: {
    id?: string;
  };
  error?: string;
  detail?: string;
}

export function EnrollToken({ consumerEmail, setConsumerEmail }: Props) {
  const { state, setState, log, setLoading, completeStep } = useAppState();
  const { loading, num } = useStepStatus("enroll");
  const [response, setResponse] = useState<unknown>(null);
  const [responseMeta, setResponseMeta] = useState<string | null>(null);

  async function handleEnroll() {
    setLoading("enroll", true);
    log(`Step ${num}: Enrolling token...`);
    try {
      const result = await apiResponse<EnrollApiBody>("POST", `/cards/${state.cardId}/agentic-tokens`, {
        data: {
          type: "agentic_tokens",
          attributes: { consumer_email: consumerEmail },
        },
      });
      const data = result.body;
      const tokenId = data?.data?.id;
      setResponse(data);
      setResponseMeta(`API response · HTTP ${result.status}${result.statusText ? ` ${result.statusText}` : ""}`);
      if (result.ok && tokenId) {
        // The enroll response is authoritative — reconcile the network against
        // it, in case PAN-based detection at card creation guessed wrong. The
        // network-specific markers live in reconcileNetwork (see flow.ts).
        const network = reconcileNetwork(data, state.network);
        setState((s) => ({ ...s, tokenId, network }));
        log(`Step ${num}: Token enrolled — ${tokenId} (${network})`);
        completeStep("enroll");
      } else {
        log(`Step ${num}: API returned HTTP ${result.status} — ${data?.error ?? JSON.stringify(data)}`);
        setLoading("enroll", false);
      }
    } catch (err) {
      log(`Step ${num}: Error — ` + (err as Error).message);
      setResponse({ error: "client_error", detail: (err as Error).message });
      setResponseMeta("Client error before API response");
      setLoading("enroll", false);
    }
  }

  return (
    <Step stepKey="enroll" title="Enroll Agentic Token" response={response} responseMeta={responseMeta}>
      <Field label="Card ID">
        <input className="input" value={state.cardId ?? ""} onChange={(e) => setState((s) => ({ ...s, cardId: e.target.value }))} />
      </Field>
      <Field label="Consumer Email">
        <input className="input" value={consumerEmail} onChange={(e) => setConsumerEmail(e.target.value)} />
      </Field>
      <Button onClick={handleEnroll} disabled={loading}>Enroll</Button>
    </Step>
  );
}
