import { useState } from "react";
import { api } from "../api";
import { useAppState, useStepStatus } from "../useAppState";
import { CRYPTOGRAM_STYLE } from "../flow";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

// Mastercard SCOF credential kinds. The cryptogram kinds require an amount +
// currency; the dynamic CVC needs neither.
const MC_DATA_TYPES = [
  { value: "CARD_APPLICATION_CRYPTOGRAM_SHORT_FORM", label: "DSRP Cryptogram (short form)", needsAmount: true },
  { value: "CARD_APPLICATION_CRYPTOGRAM_LONG_FORM", label: "DSRP Cryptogram (long form)", needsAmount: true },
  { value: "DYNAMIC_CARD_SECURITY_CODE", label: "Dynamic CVC (DTVC)", needsAmount: false },
] as const;

export function GetCryptogram() {
  const { state, log, setLoading, completeStep } = useAppState();
  const { loading, num } = useStepStatus("cryptogram");
  // Branch on the cryptogram *style*, not the network name, so a new network
  // maps onto an existing flavour (intent-scoped vs SCOF checkout) by config.
  // The two styles differ in request path, body shape, and form fields, so this
  // is the one deliberate exception to flow.ts's "config tables, no branching"
  // rule — a third style would add a branch here rather than just a table entry.
  const isScof = CRYPTOGRAM_STYLE[state.network] === "scof";

  // Visa transaction-context (cart) fields.
  const [txnAmount, setTxnAmount] = useState("5.33");
  const [txnCurrency, setTxnCurrency] = useState("USD");
  const [txnMerchant, setTxnMerchant] = useState("Best Buy");
  const [txnCountry, setTxnCountry] = useState("US");
  const [txnUrl, setTxnUrl] = useState("https://www.bestbuy.com");

  // Mastercard SCOF checkout fields.
  const [dataType, setDataType] = useState<string>("DYNAMIC_CARD_SECURITY_CODE");
  const [mcAmount, setMcAmount] = useState("59.98");
  const [mcCurrency, setMcCurrency] = useState("840");

  const [response, setResponse] = useState<unknown>(null);
  const [finalResult, setFinalResult] = useState<unknown>(null);

  const mcNeedsAmount = MC_DATA_TYPES.find((t) => t.value === dataType)?.needsAmount ?? false;

  async function handleGet() {
    setLoading("cryptogram", true);
    log(`Step ${num}: Getting cryptogram...`);
    try {
      // SCOF checkout is card-scoped with no intent; intent-style is
      // intent-scoped with a transaction-data cart.
      const query = isScof
        ? `/cryptograms?tokenId=${encodeURIComponent(state.tokenId!)}&cardId=${encodeURIComponent(state.cardId!)}`
        : `/cryptograms?tokenId=${encodeURIComponent(state.tokenId!)}&intentId=${encodeURIComponent(state.intentId!)}`;

      const attributes = isScof
        ? {
            dynamic_data_type: dataType,
            ...(mcNeedsAmount && {
              transaction_amount: parseFloat(mcAmount),
              transaction_currency_code: mcCurrency,
            }),
          }
        : {
            transaction_data: [{
              merchant_country_code: txnCountry,
              transaction_amount: {
                transaction_amount: txnAmount,
                transaction_currency_code: txnCurrency,
              },
              merchant_url: txnUrl,
              merchant_name: txnMerchant,
            }],
          };

      const data = await api("POST", query, {
        data: { type: "cryptograms", attributes },
      });
      setResponse(data);
      if (data?.data?.id) {
        log(`Step ${num}: Cryptogram received`);
        setFinalResult(data.data.attributes);
        completeStep("cryptogram");
      } else {
        log(`Step ${num}: Failed — ` + JSON.stringify(data));
        setLoading("cryptogram", false);
      }
    } catch (err) {
      log(`Step ${num}: Error — ` + (err as Error).message);
      setLoading("cryptogram", false);
    }
  }

  const title = isScof ? "Checkout — Get Cryptogram (SCOF)" : "Get Payment Cryptogram";

  return (
    <>
      <Step stepKey="cryptogram" title={title} response={response}>
        {isScof ? (
          <>
            <Field label="Token ID">
              <input className="input" readOnly value={state.tokenId ?? ""} />
            </Field>
            <Field label="Credential Type">
              <select className="input" value={dataType} onChange={(e) => setDataType(e.target.value)}>
                {MC_DATA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            {mcNeedsAmount && (
              <Row>
                <Field label="Transaction Amount">
                  <input className="input" value={mcAmount} onChange={(e) => setMcAmount(e.target.value)} />
                </Field>
                <Field label="Currency Code (ISO 4217)">
                  <select className="input" value={mcCurrency} onChange={(e) => setMcCurrency(e.target.value)}>
                    <option value="840">840 — USD</option>
                    <option value="978">978 — EUR</option>
                    <option value="826">826 — GBP</option>
                    <option value="392">392 — JPY</option>
                    <option value="036">036 — AUD</option>
                    <option value="124">124 — CAD</option>
                  </select>
                </Field>
              </Row>
            )}
            <p className="text-xs text-gray-500 mt-1">
              SCOF checkout runs directly against the enrolled card — no intent binding.
            </p>
          </>
        ) : (
          <>
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
          </>
        )}
        <Button onClick={handleGet} disabled={loading}>
          {isScof ? "Checkout" : "Get Cryptogram"}
        </Button>
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
