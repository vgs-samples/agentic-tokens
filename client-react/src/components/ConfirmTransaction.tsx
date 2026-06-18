import { useState } from "react";
import { api } from "../api";
import { useAppState, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

export function ConfirmTransaction() {
  const { state, log, setLoading, completeStep } = useAppState();
  const { loading, num } = useStepStatus("confirm");
  const [txnStatus, setTxnStatus] = useState("APPROVED");
  const [txnType, setTxnType] = useState("PURCHASE");
  const [txnAmount, setTxnAmount] = useState("5.33");
  const [txnCurrency, setTxnCurrency] = useState("USD");
  const [response, setResponse] = useState<unknown>(null);

  async function handleConfirm() {
    setLoading("confirm", true);
    log(`Step ${num}: Sending transaction confirmation...`);
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
        log(`Step ${num}: Confirmation sent — intent ${data.data.id}`);
        completeStep("confirm");
      } else {
        log(`Step ${num}: Failed — ` + JSON.stringify(data));
        setLoading("confirm", false);
      }
    } catch (err) {
      log(`Step ${num}: Error — ` + (err as Error).message);
      setLoading("confirm", false);
    }
  }

  return (
    <Step stepKey="confirm" title="Confirm Transaction" response={response}>
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
