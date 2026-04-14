import { useState } from "react";
import { api } from "../api";
import { type StepProps, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

export function ConfirmTransaction({ state, log, setLoading, completeStep }: StepProps) {
  const [txnStatus, setTxnStatus] = useState("APPROVED");
  const [txnType, setTxnType] = useState("PURCHASE");
  const [txnAmount, setTxnAmount] = useState("5.33");
  const [txnCurrency, setTxnCurrency] = useState("USD");
  const [response, setResponse] = useState<unknown>(null);

  const { done, loading, disabled } = useStepStatus(state, 6);

  async function handleConfirm() {
    setLoading(6, true);
    log("Step 6: Sending transaction confirmation...");
    try {
      const data = await api(
        "POST",
        `/confirmations?tokenId=${encodeURIComponent(state.tokenId!)}&intentId=${encodeURIComponent(state.intentId!)}`,
        {
          data: {
            type: "confirmations",
            attributes: {
              confirmation_data: [{
                payment_confirmation_data: {
                  transaction_status: txnStatus,
                  transaction_timestamp: String(Math.floor(Date.now() / 1000)),
                  transaction_type: txnType,
                  transaction_amount: {
                    transaction_amount: txnAmount,
                    transaction_currency_code: txnCurrency,
                  },
                },
              }],
            },
          },
        },
      );
      setResponse(data);
      if (data?.data?.id) {
        log(`Step 6: Confirmation sent — intent ${data.data.id}`);
        completeStep(6);
      } else {
        log("Step 6: Failed — " + JSON.stringify(data));
        setLoading(6, false);
      }
    } catch (err) {
      log("Step 6: Error — " + (err as Error).message);
      setLoading(6, false);
    }
  }

  return (
    <Step num={6} title="Confirm Transaction" active={state.activeStep === 6} done={done} loading={loading} disabled={disabled} response={response}>
      <Field label="Intent ID">
        <input className="input" readOnly value={state.intentId ?? ""} />
      </Field>
      <Row>
        <Field label="Transaction Status">
          <select className="input" value={txnStatus} onChange={(e) => setTxnStatus(e.target.value)}>
            <option>APPROVED</option>
            <option>DECLINED</option>
            <option>PENDING</option>
            <option>ERROR</option>
            <option>CANCELLED</option>
          </select>
        </Field>
        <Field label="Transaction Type">
          <select className="input" value={txnType} onChange={(e) => setTxnType(e.target.value)}>
            <option>PURCHASE</option>
            <option>AUTHORIZATION</option>
            <option>CAPTURE</option>
            <option>REFUND</option>
            <option>REVERSAL</option>
            <option>VERIFICATION</option>
            <option>CHARGEBACK</option>
            <option>FRAUD</option>
          </select>
        </Field>
      </Row>
      <Row>
        <Field label="Transaction Amount">
          <input className="input" value={txnAmount} onChange={(e) => setTxnAmount(e.target.value)} />
        </Field>
        <Field label="Currency">
          <input className="input" value={txnCurrency} onChange={(e) => setTxnCurrency(e.target.value)} />
        </Field>
      </Row>
      <Button onClick={handleConfirm} disabled={loading}>Send Confirmation</Button>
    </Step>
  );
}
