import { useState } from "react";
import { api } from "../api";
import { useAppState, useStepStatus } from "../useAppState";
import { CRYPTOGRAM_STYLE } from "../flow";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

const CURRENCY_CODES = [
  { value: "840", label: "840 - USD" },
  { value: "978", label: "978 - EUR" },
  { value: "826", label: "826 - GBP" },
  { value: "392", label: "392 - JPY" },
  { value: "036", label: "036 - AUD" },
  { value: "124", label: "124 - CAD" },
] as const;

export function GetCryptogram() {
  const { state, log, setLoading, completeStep } = useAppState();
  const { loading, num } = useStepStatus("cryptogram");
  // Branch on the cryptogram *style*, not the network name, so a new network
  // maps onto an existing flavour (intent-scoped vs SCOF checkout) by config.
  // The two styles differ in request path, body shape, and form fields, so this
  // is the one deliberate exception to flow.ts's "config tables, no branching"
  // rule — a third style would add a branch here rather than just a table entry.
  const cryptogramStyle = CRYPTOGRAM_STYLE[state.network];
  const isScof = cryptogramStyle === "scof";
  const isAmex = cryptogramStyle === "amex";
  const isCardScoped = isAmex || isScof;

  // Visa transaction-context (cart) fields.
  const [txnAmount, setTxnAmount] = useState("5.33");
  const [txnCurrency, setTxnCurrency] = useState("USD");
  const [txnMerchant, setTxnMerchant] = useState("Best Buy");
  const [txnCountry, setTxnCountry] = useState("US");
  const [txnUrl, setTxnUrl] = useState("https://www.bestbuy.com");

  // Mastercard SCOF and Amex ACE share the same demo checkout payload.
  const [cardScopedAmount, setCardScopedAmount] = useState("5.33");
  const [cardScopedCurrency, setCardScopedCurrency] = useState("840");
  const [cardScopedMerchant, setCardScopedMerchant] = useState("Best Buy");

  const [response, setResponse] = useState<unknown>(null);
  const [finalResult, setFinalResult] = useState<unknown>(null);

  async function handleGet() {
    setLoading("cryptogram", true);
    log(`Step ${num}: Getting cryptogram...`);
    try {
      // SCOF checkout is card-scoped with no intent; intent-style is
      // intent-scoped with a transaction-data cart.
      const query = isCardScoped
          ? `/cryptograms?tokenId=${encodeURIComponent(state.tokenId!)}&cardId=${encodeURIComponent(state.cardId!)}`
          : `/cryptograms?tokenId=${encodeURIComponent(state.tokenId!)}&intentId=${encodeURIComponent(state.intentId!)}`;

      const attributes = isCardScoped
        ? {
            transaction_amount: cardScopedAmount,
            transaction_currency_code: cardScopedCurrency,
            merchant_name: cardScopedMerchant,
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

  const title = isAmex
    ? "Get Payment Credential (Amex ACE)"
    : isScof
      ? "Checkout — Get Cryptogram (SCOF)"
      : "Get Payment Cryptogram";

  return (
    <>
      <Step stepKey="cryptogram" title={title} response={response}>
        {isCardScoped ? (
          <>
            <Field label={isAmex ? "Enrollment ID" : "Token ID"}>
              <input className="input" readOnly value={state.tokenId ?? ""} />
            </Field>
            <Row>
              <Field label="Transaction Amount">
                <input className="input" value={cardScopedAmount} onChange={(e) => setCardScopedAmount(e.target.value)} />
              </Field>
              <Field label="Currency">
                <select className="input" value={cardScopedCurrency} onChange={(e) => setCardScopedCurrency(e.target.value)}>
                  {CURRENCY_CODES.map((currency) => (
                    <option key={currency.value} value={currency.value}>{currency.label}</option>
                  ))}
                </select>
              </Field>
            </Row>
            <Field label="Merchant Name">
              <input className="input" value={cardScopedMerchant} onChange={(e) => setCardScopedMerchant(e.target.value)} />
            </Field>
            <p className="text-xs text-gray-500 mt-1">
              {isAmex ? "Amex ACE" : "SCOF checkout"} runs directly against the enrolled card — no intent binding.
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
          {isAmex ? "Get Credential" : isScof ? "Checkout" : "Get Cryptogram"}
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
