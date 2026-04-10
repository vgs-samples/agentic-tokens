import { useState } from "react";
import { api } from "../api";
import { type StepProps, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

const TEST_CARDS = [
  { label: "...1569 / CVV 814", pan: "4622943123121569", cvv: "814" },
  { label: "...1478 / CVV 845", pan: "4622943123121478", cvv: "845" },
];

export function CreateCard({ state, setState, log, setLoading, completeStep }: StepProps) {
  const [pan, setPan] = useState("");
  const [cvv, setCvv] = useState("");
  const [expMonth, setExpMonth] = useState("12");
  const [expYear, setExpYear] = useState("27");
  const [response, setResponse] = useState<unknown>(null);

  async function handleCreate() {
    setLoading(1, true);
    log("Step 1: Creating card...");
    try {
      const data = await api("POST", "/cards", {
        data: {
          attributes: {
            pan,
            cvc: cvv,
            exp_month: parseInt(expMonth),
            exp_year: parseInt(expYear),
          },
        },
      });
      setResponse(data);
      if (data?.data?.id) {
        setState((s) => ({ ...s, cardId: data.data.id }));
        log(`Step 1: Card created — ${data.data.id}`);
        completeStep(1);
      } else {
        log("Step 1: Failed — " + JSON.stringify(data));
        setLoading(1, false);
      }
    } catch (err) {
      log("Step 1: Error — " + (err as Error).message);
      setLoading(1, false);
    }
  }

  function prefill(index: number) {
    const card = TEST_CARDS[index];
    if (card) { setPan(card.pan); setCvv(card.cvv); }
  }

  const { done, loading } = useStepStatus(state, 1);

  return (
    <Step num={1} title="Create Card" active={state.activeStep === 1} done={done} loading={loading} disabled={false} response={response}>
      <Field label="Prefill Test Card">
        <select className="input" defaultValue="" onChange={(e) => prefill(parseInt(e.target.value))}>
          <option value="" disabled>-- select to prefill --</option>
          {TEST_CARDS.map((c, i) => <option key={i} value={i}>{c.label}</option>)}
        </select>
      </Field>
      <Row>
        <Field label="PAN">
          <input className="input" placeholder="4622943123121569" value={pan} onChange={(e) => setPan(e.target.value)} />
        </Field>
        <Field label="CVV">
          <input className="input" placeholder="845" value={cvv} onChange={(e) => setCvv(e.target.value)} />
        </Field>
      </Row>
      <Row>
        <Field label="Exp Month">
          <input className="input" type="number" value={expMonth} onChange={(e) => setExpMonth(e.target.value)} />
        </Field>
        <Field label="Exp Year">
          <input className="input" type="number" value={expYear} onChange={(e) => setExpYear(e.target.value)} />
        </Field>
      </Row>
      <Button onClick={handleCreate}>Create Card</Button>
    </Step>
  );
}
