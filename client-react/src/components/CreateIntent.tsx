import { useState } from "react";
import { api } from "../api";
import { type AppState, type LogFn } from "../useAppState";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  log: LogFn;
  setLoading: (step: number, on: boolean) => void;
  completeStep: (step: number) => void;
}

export function CreateIntent({ state, setState, log, setLoading, completeStep }: Props) {
  const [consumerPrompt, setConsumerPrompt] = useState("Allow monthly purchase up to $5.33 at Best Buy");
  const [mandateDesc, setMandateDesc] = useState("Monthly subscription");
  const [merchantName, setMerchantName] = useState("Best Buy");
  const [mcc, setMcc] = useState("1234");
  const [amount, setAmount] = useState("5.33");
  const [currency, setCurrency] = useState("USD");
  const [quantity, setQuantity] = useState("1");
  const [effectiveUntil, setEffectiveUntil] = useState("2026-06-15T00:00:00Z");
  const [response, setResponse] = useState<unknown>(null);

  const done = state.completedSteps.has(4);
  const loading = state.loadingSteps.has(4);
  const disabled = !done && state.activeStep < 4;

  async function handleCreate() {
    setLoading(4, true);
    log("Step 4: Creating intent...");
    try {
      const assuranceData = state.assuranceData;
      const data = await api("POST", `/intents?tokenId=${encodeURIComponent(state.tokenId!)}`, {
        data: {
          type: "intents",
          attributes: {
            consumer_prompt: consumerPrompt,
            assurance_data: assuranceData,
            mandates: [{
              description: mandateDesc,
              merchant_category: "Electronics",
              preferred_merchant_name: merchantName,
              merchant_category_code: mcc,
              decline_threshold: {
                amount: parseFloat(amount),
                currency_code: currency,
              },
              effective_until: effectiveUntil,
              quantity: parseInt(quantity),
            }],
          },
        },
      });
      setResponse(data);
      if (data?.data?.id) {
        setState((s) => ({ ...s, intentId: data.data.id }));
        log(`Step 4: Intent created — ${data.data.id}`);
        completeStep(4);
      } else {
        log("Step 4: Failed — " + JSON.stringify(data));
        setLoading(4, false);
      }
    } catch (err) {
      log("Step 4: Error — " + (err as Error).message);
      setLoading(4, false);
    }
  }

  const assuranceJson = state.assuranceData ? JSON.stringify(state.assuranceData, null, 2) : "";

  return (
    <Step num={4} title="Create Intent" active={state.activeStep === 4} done={done} loading={loading} disabled={disabled} response={response}>
      <Field label="Assurance Data">
        <textarea className="input min-h-[60px] resize-y" readOnly rows={3} value={assuranceJson} />
      </Field>
      <Field label="Consumer Prompt">
        <input className="input" value={consumerPrompt} onChange={(e) => setConsumerPrompt(e.target.value)} />
      </Field>
      <Field label="Mandate — Description">
        <input className="input" value={mandateDesc} onChange={(e) => setMandateDesc(e.target.value)} />
      </Field>
      <Row>
        <Field label="Merchant Name">
          <input className="input" value={merchantName} onChange={(e) => setMerchantName(e.target.value)} />
        </Field>
        <Field label="MCC">
          <input className="input" value={mcc} onChange={(e) => setMcc(e.target.value)} />
        </Field>
      </Row>
      <Row>
        <Field label="Amount">
          <input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Currency">
          <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} />
        </Field>
      </Row>
      <Row>
        <Field label="Quantity">
          <input className="input" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label="Effective Until">
          <input className="input" value={effectiveUntil} onChange={(e) => setEffectiveUntil(e.target.value)} />
        </Field>
      </Row>
      <Button onClick={handleCreate}>Create Intent</Button>
    </Step>
  );
}
