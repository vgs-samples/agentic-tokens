import { useState } from "react";
import { apiResponse } from "../api";
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
  const { state, setState, log, setLoading, completeStep } = useAppState();
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
  const [responseMeta, setResponseMeta] = useState<string | null>(null);
  const [action, setAction] = useState<"get" | "delete" | null>(null);
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const [finalResult, setFinalResult] = useState<{ scope: string; attributes: unknown } | null>(null);
  const tokenId = state.tokenId?.trim() ?? "";
  const resultScope = `${state.network}/${state.cardId}/${tokenId}`;

  function handleTokenIdChange(value: string) {
    setResponse(null);
    setResponseMeta(null);
    setFinalResult(null);
    setDeletedId(null);
    setState((s) => {
      const completedSteps = new Set(s.completedSteps);
      completedSteps.delete("cryptogram");
      return { ...s, tokenId: value, completedSteps };
    });
  }

  async function handleGet() {
    if (loading || !tokenId || (isCardScoped ? !state.cardId?.trim() : !state.intentId?.trim())) return;
    setAction("get");
    setDeletedId(null);
    setFinalResult(null);
    setLoading("cryptogram", true);
    log(`Step ${num}: Getting cryptogram...`);
    try {
      // SCOF checkout is card-scoped with no intent; intent-style is
      // intent-scoped with a transaction-data cart.
      const query = isCardScoped
          ? `/cryptograms?tokenId=${encodeURIComponent(tokenId)}&cardId=${encodeURIComponent(state.cardId!)}`
          : `/cryptograms?tokenId=${encodeURIComponent(tokenId)}&intentId=${encodeURIComponent(state.intentId!)}`;

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

      const result = await apiResponse<{ data?: { id?: string; attributes?: unknown } }>("POST", query, {
        data: { type: "cryptograms", attributes },
      });
      const data = result.body;
      setResponse(data);
      setResponseMeta(`Get credential · HTTP ${result.status}`);
      if (result.ok && data?.data?.id) {
        log(`Step ${num}: Cryptogram received`);
        setFinalResult({ scope: resultScope, attributes: data.data.attributes });
        completeStep("cryptogram");
      } else {
        log(`Step ${num}: Failed — ` + JSON.stringify(data));
        setLoading("cryptogram", false);
      }
    } catch (err) {
      log(`Step ${num}: Error — ` + (err as Error).message);
      setResponse({ error: "client_error", detail: (err as Error).message });
      setResponseMeta("Get credential · Client error");
    } finally {
      setLoading("cryptogram", false);
      setAction(null);
    }
  }

  async function handleDelete() {
    if (loading || !tokenId || !isCardScoped) return;
    setAction("delete");
    setDeletedId(null);
    setLoading("cryptogram", true);
    log(`Step ${num}: Deleting ${state.network} enrollment — ${tokenId}`);
    try {
      const query = new URLSearchParams({ tokenId, network: state.network });
      const result = await apiResponse<{ data?: { id?: string; attributes?: { status?: string } } }>(
        "DELETE", `/token-deletion?${query}`,
      );
      setResponse(result.body);
      setResponseMeta(`Delete enrollment · HTTP ${result.status}`);
      if (result.ok && result.body?.data?.attributes?.status === "deleted") {
        setDeletedId(tokenId);
        setFinalResult(null);
        setState((s) => {
          const completedSteps = new Set(s.completedSteps);
          completedSteps.delete("enroll");
          completedSteps.delete("cryptogram");
          return { ...s, tokenId: null, completedSteps };
        });
        log(`Step ${num}: Enrollment deleted — ${tokenId}`);
      } else {
        log(`Step ${num}: Deletion failed — HTTP ${result.status}`);
      }
    } catch (err) {
      setResponse({ error: "client_error", detail: (err as Error).message });
      setResponseMeta("Delete enrollment · Client error");
      log(`Step ${num}: Deletion error — ${(err as Error).message}`);
    } finally {
      setLoading("cryptogram", false);
      setAction(null);
    }
  }

  const title = isAmex
    ? "Manage Enrollment — Amex ACE"
    : isScof
      ? "Manage Token — Mastercard SCOF"
      : "Get Payment Cryptogram";

  return (
    <>
      <Step stepKey="cryptogram" title={title} response={response} responseMeta={responseMeta}>
        {isCardScoped ? (
          <>
            <Field label={isAmex ? "Enrollment ID" : "Token ID"}>
              <input
                className="input"
                aria-label={isAmex ? "Enrollment ID" : "Token ID"}
                value={state.tokenId ?? ""}
                onChange={(e) => handleTokenIdChange(e.target.value)}
                disabled={loading}
                placeholder="Paste an existing ID or use the enrollment response"
              />
            </Field>
            <p className="text-xs text-gray-500">Get a payment credential or delete the enrollment using this ID.</p>
            {deletedId && !tokenId && (
              <p role="status" className="text-sm text-green-700">
                Enrollment {deletedId} deleted. Enroll again or enter another ID.
              </p>
            )}
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
        <div className="flex flex-wrap gap-3">
          <Button onClick={handleGet} disabled={loading || !tokenId || (isCardScoped ? !state.cardId?.trim() : !state.intentId?.trim())}>
            {action === "get" ? "Getting credential..." : isAmex ? "Get Credential" : isScof ? "Checkout" : "Get Cryptogram"}
          </Button>
          {isCardScoped && (
            <Button onClick={handleDelete} disabled={loading || !tokenId} variant="danger">
              {action === "delete" ? "Deleting..." : "Delete Enrollment"}
            </Button>
          )}
        </div>
      </Step>

      {finalResult && finalResult.scope === resultScope && (
        <div className="bg-green-50 border-2 border-green-500 rounded-lg p-4 mt-4">
          <h2 className="text-base font-semibold mb-2">Payment Credential</h2>
          <pre className="bg-[#1e1e1e] text-[#d4d4d4] p-3 rounded text-sm whitespace-pre-wrap break-all">
            {JSON.stringify(finalResult.attributes, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}
