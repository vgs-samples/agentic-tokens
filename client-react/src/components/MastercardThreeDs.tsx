import { useEffect, useRef, useState } from "react";
import { launchThreeDs, prepareThreeDs } from "../idv";
import { useAppState } from "../useAppState";
import { Button } from "./ui";

export function MastercardThreeDs({ identifier, onStart, onResponse, onError }: {
  identifier: string; onStart: () => void; onResponse: (body: unknown) => void; onError: (error: unknown) => void;
}) {
  const { state, setState, setLoading, completeStep, log } = useAppState();
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
      flow.current = launchThreeDs(window, () => prepareThreeDs(tokenId, identifier),
        window.location.origin, (message) => { if (mounted.current) onResponse(message); });
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
    <p className="text-sm text-gray-500">Your bank will verify the card in a secure Mastercard window.</p>
    <Button onClick={start} disabled={busy}>Verify with Bank (3DS)</Button>
    {active && <Button variant="secondary" onClick={() => flow.current?.cancel()}>Cancel Verification</Button>}
  </div>;
}
