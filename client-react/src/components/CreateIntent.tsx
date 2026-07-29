import { useState } from "react";
import { api } from "../api";
import { useAppState, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

export function CreateIntent() {
  const { state, setState, log, setLoading, completeStep } = useAppState();
  const { loading, num } = useStepStatus("intent");
  const [consumerPrompt, setConsumerPrompt] = useState("Allow monthly purchase up to $5.33 at Best Buy");
  const [mandateDesc, setMandateDesc] = useState("Monthly subscription");
  const [merchantName, setMerchantName] = useState("Best Buy");
  const [mcc, setMcc] = useState("1234");
  const [amount, setAmount] = useState("5.33");
  const [currency, setCurrency] = useState("USD");
  const [quantity, setQuantity] = useState("1");
  const [effectiveUntil, setEffectiveUntil] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 10);
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  });
  const [response, setResponse] = useState<unknown>(null);

  async function handleCreate() {
    setLoading("intent", true);
    log(`Step ${num}: Creating intent...`);
    try {
      // The ID&V flow produces no assurance_data — omit the field entirely rather than
      // sending null. Under the passkey flow it carries the FIDO result.
      const assuranceData = state.assuranceData;
      const data = await api("POST", `/intents?tokenId=${encodeURIComponent(state.tokenId!)}`, {
        data: {
          type: "intents",
          attributes: {
            consumer_prompt: consumerPrompt,
            ...(assuranceData?.length ? { assurance_data: assuranceData } : {}),
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
        log(`Step ${num}: Intent created — ${data.data.id}`);
        completeStep("intent");
      } else {
        log(`Step ${num}: Failed — ` + JSON.stringify(data));
        setLoading("intent", false);
      }
    } catch (err) {
      log(`Step ${num}: Error — ` + (err as Error).message);
      setLoading("intent", false);
    }
  }

  const assuranceJson = state.assuranceData ? JSON.stringify(state.assuranceData, null, 2) : "";

  return (
    <Step stepKey="intent" title="Create Intent" response={response}>
      <Field label={assuranceJson ? "Assurance Data" : "Assurance Data (not used in this flow)"}>
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
      <Button onClick={handleCreate} disabled={loading}>Create Intent</Button>
    </Step>
  );
}
