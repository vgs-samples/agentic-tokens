import { useEffect, useRef, useState } from "react";
import { launchThreeDs, prepareThreeDs } from "../idv";
import { useAppState } from "../useAppState";
import { Button, Field, Row } from "./ui";

export function MastercardThreeDs({ identifier, onStart, onResponse, onError }: {
  identifier: string; onStart: () => void; onResponse: (body: unknown) => void; onError: (error: unknown) => void;
}) {
  const { state, setState, setLoading, completeStep, log } = useAppState();
  const [merchantId, setMerchantId] = useState("");
  const [bin, setBin] = useState("");
  const [merchant, setMerchant] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState("US");
  const [line1, setLine1] = useState("");
  const [active, setActive] = useState(false);
  const flow = useRef<ReturnType<typeof launchThreeDs> | null>(null);
  const mounted = useRef(true);
  const busy = state.loadingSteps.size > 0;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; flow.current?.cancel(); if (flow.current) setLoading("idv", false); };
  }, [setLoading]);

  async function start() {
    if (!state.tokenId || busy || flow.current) return;
    const tokenId = state.tokenId;
    onStart();
    setLoading("idv", true);
    try {
      flow.current = launchThreeDs(window, () => prepareThreeDs(tokenId, identifier, {
        acquirer_merchant_id: merchantId.trim(), acquirer_bin: bin.trim(), merchant_name: merchant.trim(),
        billing_address: { zip: zip.trim(), country_code: country.trim().toUpperCase(), ...(line1.trim() ? { line1: line1.trim() } : {}) },
      }), window.location.origin, (message) => { if (mounted.current) onResponse(message); });
      setActive(true);
      const result = await flow.current.result;
      if (!mounted.current) return;
      onResponse(result.raw);
      setState((s) => s.tokenId !== tokenId ? s : {
        ...s, otpVerifiedTokenId: tokenId, mastercardAssuranceData: result.assuranceData,
      });
      log("Mastercard: bank verification completed.");
      completeStep("idv");
    } catch (error) { if (mounted.current) onError(error); }
    finally { flow.current = null; if (mounted.current) { setActive(false); setLoading("idv", false); } }
  }

  return <div className="mt-3">
    <p className="text-sm text-gray-500">Your bank will verify the card in a secure Mastercard window.
      Use the acquiring identifiers assigned during your Mastercard onboarding.</p>
    <fieldset disabled={busy}>
      <Row>
        <Field label="Acquirer merchant ID"><input className="input" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} /></Field>
        <Field label="Acquirer BIN"><input className="input" value={bin} onChange={(e) => setBin(e.target.value)} /></Field>
      </Row>
      <Field label="Registered merchant name"><input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} /></Field>
      <Field label="Billing address (optional)"><input className="input" value={line1} onChange={(e) => setLine1(e.target.value)} /></Field>
      <Row>
        <Field label="Billing postal code"><input className="input" value={zip} onChange={(e) => setZip(e.target.value)} /></Field>
        <Field label="Billing country"><input className="input" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} /></Field>
      </Row>
      <Button onClick={start} disabled={busy || !merchantId.trim() || !bin.trim() || !merchant.trim() || !zip.trim() || country.trim().length !== 2}>
        Verify with Bank (3DS)
      </Button>
    </fieldset>
    {active && <Button variant="secondary" onClick={() => flow.current?.cancel()}>Cancel Verification</Button>}
  </div>;
}
