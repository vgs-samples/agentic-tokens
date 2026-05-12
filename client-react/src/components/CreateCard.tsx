import { useEffect, useRef, useState } from "react";
import { fetchAccessToken, fetchConfig } from "../api";
import { useAppState, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

// VGS Collect inputs live inside cross-origin iframes — their values cannot be
// set programmatically. We surface the sandbox test cards as a hint instead.
const TEST_CARDS = [
  { label: "...1569 / CVV 814 / 12/27", pan: "4622943123121569", cvv: "814", exp: "12 / 27" },
  { label: "...1478 / CVV 845 / 12/27", pan: "4622943123121478", cvv: "845", exp: "12 / 27" },
];

const FIELD_CSS = {
  "font-size": "14px",
  "font-family": "ui-sans-serif, system-ui, sans-serif",
  color: "#1f2937",
  "&::placeholder": { color: "#9ca3af" },
};

export function CreateCard() {
  const { setState, log, setLoading, completeStep } = useAppState();
  const { loading } = useStepStatus(1);
  const [response, setResponse] = useState<unknown>(null);
  const [formReady, setFormReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const formRef = useRef<VgsCollectForm | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const cfg = await fetchConfig();
        if (cancelled) return;
        if (!cfg.vaultId) {
          setInitError("VGS_VAULT_ID is not configured on the server.");
          return;
        }
        if (!window.VGSCollect) {
          setInitError("VGS Collect.js failed to load.");
          return;
        }

        const form = window.VGSCollect.create(cfg.vaultId, cfg.vaultEnv);
        formRef.current = form;

        form.field("#cc-number", {
          type: "card-number",
          name: "card_number",
          placeholder: "4622 9431 2312 1569",
          validations: ["required", "validCardNumber"],
          showCardIcon: true,
          css: FIELD_CSS,
        });

        form.field("#cc-cvc", {
          type: "card-security-code",
          name: "card_cvc",
          placeholder: "CVV",
          validations: ["required", "validCardSecurityCode"],
          css: FIELD_CSS,
        });

        form.field("#cc-exp", {
          type: "card-expiration-date",
          name: "card_exp",
          placeholder: "MM / YY",
          validations: ["required", "validCardExpirationDate"],
          yearLength: 2,
          css: FIELD_CSS,
        });

        setFormReady(true);
      } catch (err) {
        setInitError("Failed to initialize Collect.js: " + (err as Error).message);
      }
    }

    init();
    return () => {
      cancelled = true;
      formRef.current?.destroy?.();
      formRef.current = null;
    };
  }, []);

  async function handleCreate() {
    if (!formRef.current) return;
    setLoading(1, true);
    log("Step 1: Creating card via Collect.js…");
    try {
      const accessToken = await fetchAccessToken();
      const session = formRef.current.session({ accessToken });
      const card = await session.createCard();
      setResponse(card);
      if (card?.id) {
        setState((s) => ({ ...s, cardId: card.id }));
        log(`Step 1: Card created — ${card.id}`);
        completeStep(1);
      } else {
        log("Step 1: Failed — " + JSON.stringify(card));
        setLoading(1, false);
      }
    } catch (err) {
      log("Step 1: Error — " + (err as Error).message);
      setResponse({ error: (err as Error).message });
      setLoading(1, false);
    }
  }

  return (
    <Step num={1} title="Create Card (VGS Collect)" response={response}>
      {initError && (
        <div className="bg-red-50 border border-red-300 text-red-700 text-sm rounded p-2 mb-2">
          {initError}
        </div>
      )}

      <Field label="Test Cards (type these manually — iframes cannot be prefilled)">
        <div className="text-xs text-gray-500 space-y-0.5">
          {TEST_CARDS.map((c, i) => (
            <div key={i} className="font-mono">{c.label}</div>
          ))}
        </div>
      </Field>

      <Field label="Card Number">
        <div id="cc-number" className="input min-h-[36px] flex items-center" />
      </Field>
      <Row>
        <Field label="Expiration">
          <div id="cc-exp" className="input min-h-[36px] flex items-center" />
        </Field>
        <Field label="CVV">
          <div id="cc-cvc" className="input min-h-[36px] flex items-center" />
        </Field>
      </Row>

      <Button onClick={handleCreate} disabled={!formReady || loading}>
        {formReady ? "Create Card" : "Loading Collect.js…"}
      </Button>
    </Step>
  );
}
