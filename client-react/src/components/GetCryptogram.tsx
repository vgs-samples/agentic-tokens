import { useState } from "react";
import { api } from "../api";
import { type AppState, type LogFn } from "../useAppState";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

interface Props {
  state: AppState;
  log: LogFn;
  setLoading: (step: number, on: boolean) => void;
  completeStep: (step: number) => void;
}

export function GetCryptogram({ state, log, setLoading, completeStep }: Props) {
  const [txnAmount, setTxnAmount] = useState("5.33");
  const [txnCurrency, setTxnCurrency] = useState("USD");
  const [txnMerchant, setTxnMerchant] = useState("Best Buy");
  const [txnCountry, setTxnCountry] = useState("US");
  const [txnUrl, setTxnUrl] = useState("https://www.bestbuy.com");
  const [response, setResponse] = useState<unknown>(null);
  const [finalResult, setFinalResult] = useState<unknown>(null);

  const done = state.completedSteps.has(5);
  const loading = state.loadingSteps.has(5);
  const disabled = !done && state.activeStep < 5;

  async function handleGet() {
    setLoading(5, true);
    log("Step 5: Getting cryptogram...");
    try {
      const data = await api(
        "POST",
        `/cryptograms?tokenId=${encodeURIComponent(state.tokenId!)}&intentId=${encodeURIComponent(state.intentId!)}`,
        {
          data: {
            type: "cryptograms",
            attributes: {
              transaction_data: [{
                merchant_country_code: txnCountry,
                transaction_amount: {
                  transaction_amount: txnAmount,
                  transaction_currency_code: txnCurrency,
                },
                merchant_url: txnUrl,
                merchant_name: txnMerchant,
              }],
            },
          },
        },
      );
      setResponse(data);
      if (data?.data?.id) {
        log("Step 5: Cryptogram received");
        setFinalResult(data.data.attributes);
        completeStep(5);
      } else {
        log("Step 5: Failed — " + JSON.stringify(data));
        setLoading(5, false);
      }
    } catch (err) {
      log("Step 5: Error — " + (err as Error).message);
      setLoading(5, false);
    }
  }

  return (
    <>
      <Step num={5} title="Get Payment Cryptogram" active={state.activeStep === 5} done={done} loading={loading} disabled={disabled} response={response}>
        <Field label="Intent ID">
          <input className="input" readOnly value={state.intentId ?? ""} />
        </Field>
        <Row>
          <Field label="Transaction Amount">
            <input className="input" value={txnAmount} onChange={(e) => setTxnAmount(e.target.value)} />
          </Field>
          <Field label="Currency">
            <input className="input" value={txnCurrency} onChange={(e) => setTxnCurrency(e.target.value)} />
          </Field>
        </Row>
        <Row>
          <Field label="Merchant Name">
            <input className="input" value={txnMerchant} onChange={(e) => setTxnMerchant(e.target.value)} />
          </Field>
          <Field label="Merchant Country">
            <input className="input" value={txnCountry} onChange={(e) => setTxnCountry(e.target.value)} />
          </Field>
        </Row>
        <Field label="Merchant URL">
          <input className="input" value={txnUrl} onChange={(e) => setTxnUrl(e.target.value)} />
        </Field>
        <Button onClick={handleGet}>Get Cryptogram</Button>
      </Step>

      {finalResult && (
        <div className="bg-green-50 border-2 border-green-500 rounded-lg p-4 mt-4">
          <h2 className="text-base font-semibold mb-2">Payment Credential</h2>
          <pre className="bg-[#1e1e1e] text-[#d4d4d4] p-3 rounded text-sm whitespace-pre-wrap break-all">
            {JSON.stringify(finalResult, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}
