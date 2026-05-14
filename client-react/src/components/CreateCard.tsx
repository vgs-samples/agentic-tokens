import { useEffect, useRef, useState } from "react";
import { fetchAccessToken, fetchConfig } from "../api";
import { useAppState, useStepStatus } from "../useAppState";
import { Step } from "./Step";
import { Field, Row, Button } from "./ui";

const FIELD_CSS = {
  "font-size": "14px",
  "font-family": "ui-sans-serif, system-ui, sans-serif",
  color: "#1f2937",
  "&::placeholder": { color: "#9ca3af" },
};

type CardOption = "card1" | "card2" | "custom";

interface TestCard {
  id: CardOption;
  label: string;
  pan: string;
  cvv: string;
  exp: string;
}

const TEST_CARDS: TestCard[] = [
  { id: "card1", label: "Card 1 — ...1569 / CVV 814 / 12/27", pan: "4622943123121569", cvv: "814", exp: "12 / 27" },
  { id: "card2", label: "Card 2 — ...1478 / CVV 845 / 12/27", pan: "4622943123121478", cvv: "845", exp: "12 / 27" },
];

export function CreateCard() {
  const { setState, log, setLoading, completeStep } = useAppState();
  const { loading } = useStepStatus(1);
  const [response, setResponse] = useState<unknown>(null);
  const [option, setOption] = useState<CardOption>("card1");
  const [formInitialized, setFormInitialized] = useState(false);
  // Derived "ready" state — set after fields for the current option finish loading.
  // Comparing against the live `option` keeps the button disabled while remounting,
  // without a synchronous setState in the effect body.
  const [readyForOption, setReadyForOption] = useState<CardOption | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const formRef = useRef<VgsCollectForm | null>(null);
  const fieldsRef = useRef<{
    number?: VgsCollectField;
    cvc?: VgsCollectField;
    exp?: VgsCollectField;
  }>({});

  const fieldsReady = readyForOption === option;

  // Create the Collect form once on mount.
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

        const form = await window.VGSCollect.session({
          vaultId: cfg.vaultId,
          env: cfg.vaultEnv,
          stateCallback: () => {},
          authHandler: async () => await fetchAccessToken(),
        });
        if (cancelled) {
          form?.destroy?.();
          return;
        }
        formRef.current = form;
        setFormInitialized(true);
      } catch (err) {
        if (!cancelled) {
          setInitError("Failed to initialize Collect.js: " + (err as Error).message);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      formRef.current?.destroy?.();
      formRef.current = null;
    };
  }, []);

  // (Re)create fields whenever the selected option changes.
  // For card1/card2 — fields are created with prefillValue and prefilled after load.
  // For custom — fields are created empty.
  useEffect(() => {
    if (!formInitialized || !formRef.current) return;
    let cancelled = false;

    // Tear down any existing fields so the iframes remount cleanly with new options.
    fieldsRef.current.number?.delete();
    fieldsRef.current.cvc?.delete();
    fieldsRef.current.exp?.delete();
    fieldsRef.current = {};

    const card = TEST_CARDS.find((c) => c.id === option);
    const form = formRef.current;

    const numberField = form.cardNumberField("#cc-number", {
      placeholder: "Card number",
      css: FIELD_CSS,
      showCardIcon: true,
      ...(card && { prefillValue: card.pan }),
    });
    const cvcField = form.cardCVCField("#cc-cvc", {
      placeholder: "CVV",
      css: FIELD_CSS,
      ...(card && { prefillValue: card.cvv }),
    });
    const expField = form.cardExpirationDateField("#cc-exp", {
      placeholder: "MM / YY",
      yearLength: 2,
      css: FIELD_CSS,
      ...(card && { prefillValue: card.exp }),
    });
    fieldsRef.current = { number: numberField, cvc: cvcField, exp: expField };

    Promise.all([numberField.promise, cvcField.promise, expField.promise]).then(() => {
      if (cancelled) return;
      if (card) {
        numberField.prefill();
        cvcField.prefill();
        expField.prefill();
      }
      setReadyForOption(option);
    });

    return () => {
      cancelled = true;
    };
  }, [formInitialized, option]);

  async function handleCreate() {
    const form = formRef.current;
    if (!form) return;
    setLoading(1, true);
    log("Step 1: Creating card via Collect.js…");
    try {
      const result = await form.createCard();
      setResponse(result);
      const cardId = result?.data?.data?.id;
      if (cardId) {
        setState((s) => ({ ...s, cardId }));
        log(`Step 1: Card created — ${cardId}`);
        completeStep(1);
      } else {
        log("Step 1: Failed — " + JSON.stringify(result));
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

      <Field label="Card Selection">
        <select
          className="input"
          value={option}
          onChange={(e) => setOption(e.target.value as CardOption)}
        >
          {TEST_CARDS.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
          <option value="custom">Enter your own card</option>
        </select>
      </Field>

      <Field label="Card Number">
        <div id="cc-number" className="input collect-field min-h-[36px] flex items-center" />
      </Field>
      <Row>
        <Field label="Expiration">
          <div id="cc-exp" className="input collect-field min-h-[36px] flex items-center" />
        </Field>
        <Field label="CVV">
          <div id="cc-cvc" className="input collect-field min-h-[36px] flex items-center" />
        </Field>
      </Row>

      <Button onClick={handleCreate} disabled={!fieldsReady || loading}>
        {fieldsReady ? "Create Card" : "Loading Collect.js…"}
      </Button>
    </Step>
  );
}
