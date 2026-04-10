import { VgsAgenticAuth, VgsAgenticAuthError } from "/sdk/vgs-agentic-auth.js";

const API_URL = `http://${location.hostname}:3000`;

// --- State ---
let state = {
  cardId: null,
  tokenId: null,
  intentId: null,
  assuranceData: null,
  session: null,
};

// --- Helpers ---

function $(id) {
  return document.getElementById(id);
}

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  const el = $("log");
  el.textContent += `[${ts}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}

function showResponse(stepNum, data) {
  const el = $(`res-${stepNum}`);
  el.textContent = JSON.stringify(data, null, 2);
  el.hidden = false;
}

function activateStep(stepNum) {
  const el = $(`step-${stepNum}`);
  el.classList.remove("disabled");
  el.classList.add("active");
}

function completeStep(stepNum) {
  const el = $(`step-${stepNum}`);
  el.classList.remove("active", "loading");
  el.classList.add("done");
  if ($(`step-${stepNum + 1}`)) {
    activateStep(stepNum + 1);
  }
}

function startLoading(stepNum) {
  $(`step-${stepNum}`).classList.add("loading");
}

function stopLoading(stepNum) {
  $(`step-${stepNum}`).classList.remove("loading");
}

async function api(method, path, body) {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  return res.json();
}

// --- Step 1: Create Card ---

window.createCard = async function () {
  startLoading(1);
  log("Step 1: Creating card...");

  const body = {
    data: {
      attributes: {
        pan: $("pan").value,
        cvc: $("cvv").value,
        exp_month: parseInt($("exp-month").value),
        exp_year: parseInt($("exp-year").value),
      },
    },
  };

  try {
    const data = await api("POST", "/cards", body);
    showResponse(1, data);

    if (data?.data?.id) {
      state.cardId = data.data.id;
      $("card-id").value = state.cardId;
      log(`Step 1: Card created — ${state.cardId}`);
      completeStep(1);
    } else {
      log("Step 1: Failed — " + JSON.stringify(data));
      stopLoading(1);
    }
  } catch (err) {
    log("Step 1: Error — " + err.message);
    stopLoading(1);
  }
};

// --- Step 2: Enroll Token ---

window.enrollToken = async function () {
  startLoading(2);
  log("Step 2: Enrolling token...");

  const body = {
    data: {
      type: "agentic_tokens",
      attributes: {
        consumer_email: $("consumer-email").value,
      },
    },
  };

  try {
    const data = await api("POST", `/cards/${state.cardId}/agentic-tokens`, body);
    showResponse(2, data);

    if (data?.data?.id) {
      state.tokenId = data.data.id;
      $("token-id").value = state.tokenId;
      log(`Step 2: Token enrolled — ${state.tokenId}`);
      completeStep(2);
    } else {
      log("Step 2: Failed — " + JSON.stringify(data));
      stopLoading(2);
    }
  } catch (err) {
    log("Step 2: Error — " + err.message);
    stopLoading(2);
  }
};

// --- Step 3: Device Binding ---

window.startDeviceBinding = async function () {
  startLoading(3);
  $("btn-start-session").disabled = true;
  log("Step 3: Starting device binding session...");

  try {
    const tokenRes = await fetch(`${API_URL}/api/token`);
    const { access_token } = await tokenRes.json();

    const clientRefId = crypto.randomUUID();
    log(`Step 3: clientRefId=${clientRefId}`);

    const flow = new VgsAgenticAuth({
      tokenId: state.tokenId,
      environment: $("environment").value,
      consumerEmail: $("consumer-email").value,
      accessToken: access_token,
      clientRefId,
    });

    const session = await flow.startSession($("iframe-container"));
    state.session = session;
    log("Step 3: Session created. needsOtp=" + session.needsOtp);

    if (session.needsOtp) {
      $("otp-section").hidden = false;
      stopLoading(3);
    } else {
      showAuthenticateButton();
      stopLoading(3);
    }
  } catch (err) {
    log("Step 3: Session error — " + err.message);
    showResponse(3, { error: err.message, code: err.code, status: err.status });
    $("btn-start-session").disabled = false;
    stopLoading(3);
  }
};

function showAuthenticateButton() {
  $("btn-authenticate").hidden = false;
  if (state.session?.iframe) {
    state.session.iframe.width = 300;
    state.session.iframe.height = 400;
  }
}

window.submitOtp = async function () {
  startLoading(3);
  log("Step 3: Submitting OTP...");
  try {
    await state.session.submitOtp($("otp-code").value.trim());
    $("otp-section").hidden = true;
    log("Step 3: OTP accepted");
    showAuthenticateButton();
    stopLoading(3);
  } catch (err) {
    log("Step 3: OTP error — " + err.message);
    showResponse(3, { error: err.message, code: err.code });
    stopLoading(3);
  }
};

window.authenticate = async function () {
  startLoading(3);
  $("btn-authenticate").disabled = true;
  log("Step 3: Running FIDO ceremony...");

  try {
    const assuranceData = await state.session.authenticate();
    state.assuranceData = assuranceData;
    state.session.destroy();
    state.session = null;

    $("assurance-data").value = JSON.stringify(assuranceData, null, 2);
    showResponse(3, { assuranceData });
    log("Step 3: Device binding complete");
    completeStep(3);
  } catch (err) {
    log("Step 3: FIDO error — " + err.message);
    showResponse(3, { error: err.message, code: err.code });
    $("btn-authenticate").disabled = false;
    stopLoading(3);
  }
};

// --- Step 4: Create Intent ---

window.createIntent = async function () {
  startLoading(4);
  log("Step 4: Creating intent...");

  const body = {
    data: {
      type: "intents",
      attributes: {
        consumer_prompt: $("consumer-prompt").value,
        assurance_data: JSON.parse($("assurance-data").value),
        mandates: [
          {
            description: $("mandate-desc").value,
            merchant_category: "Electronics",
            preferred_merchant_name: $("merchant-name").value,
            merchant_category_code: $("mcc").value,
            decline_threshold: {
              amount: parseFloat($("amount").value),
              currency_code: $("currency").value,
            },
            effective_until: $("effective-until").value,
            quantity: parseInt($("quantity").value),
          },
        ],
      },
    },
  };

  try {
    const data = await api(
      "POST",
      `/intents?tokenId=${encodeURIComponent(state.tokenId)}`,
      body
    );
    showResponse(4, data);

    if (data?.data?.id) {
      state.intentId = data.data.id;
      $("intent-id").value = state.intentId;
      log(`Step 4: Intent created — ${state.intentId}`);
      completeStep(4);
    } else {
      log("Step 4: Failed — " + JSON.stringify(data));
      stopLoading(4);
    }
  } catch (err) {
    log("Step 4: Error — " + err.message);
    stopLoading(4);
  }
};

// --- Step 5: Get Cryptogram ---

window.getCryptogram = async function () {
  startLoading(5);
  log("Step 5: Getting cryptogram...");

  const body = {
    data: {
      type: "cryptograms",
      attributes: {
        transaction_data: [
          {
            merchant_country_code: $("txn-country").value,
            transaction_amount: {
              transaction_amount: $("txn-amount").value,
              transaction_currency_code: $("txn-currency").value,
            },
            merchant_url: $("txn-url").value,
            merchant_name: $("txn-merchant").value,
          },
        ],
      },
    },
  };

  try {
    const data = await api(
      "POST",
      `/cryptograms?tokenId=${encodeURIComponent(state.tokenId)}&intentId=${encodeURIComponent(state.intentId)}`,
      body
    );
    showResponse(5, data);

    if (data?.data?.id) {
      log("Step 5: Cryptogram received");
      completeStep(5);

      // Show final result
      const result = $("result");
      result.hidden = false;
      $("result-output").textContent = JSON.stringify(data.data.attributes, null, 2);
      result.scrollIntoView({ behavior: "smooth" });
    } else {
      log("Step 5: Failed — " + JSON.stringify(data));
      stopLoading(5);
    }
  } catch (err) {
    log("Step 5: Error — " + err.message);
    stopLoading(5);
  }
};

// --- UI ---

window.startOver = function () {
  if (state.session) {
    state.session.destroy();
  }
  state = { cardId: null, tokenId: null, intentId: null, assuranceData: null, session: null };

  // Reset all steps
  for (let i = 1; i <= 5; i++) {
    const el = $(`step-${i}`);
    el.classList.remove("active", "done", "disabled", "loading");
    el.classList.add(i === 1 ? "active" : "disabled");
    const res = $(`res-${i}`);
    if (res) { res.hidden = true; res.textContent = ""; }
  }

  // Reset inputs
  $("card-id").value = "";
  $("token-id").value = "";
  $("intent-id").value = "";
  $("assurance-data").value = "";
  $("otp-code").value = "";
  $("test-card").selectedIndex = 0;
  $("pan").value = "";
  $("cvv").value = "";

  // Reset buttons
  $("btn-start-session").disabled = false;
  $("btn-authenticate").hidden = true;
  $("btn-authenticate").disabled = false;
  $("otp-section").hidden = true;
  $("iframe-container").innerHTML = "";

  // Reset result
  $("result").hidden = true;
  $("result-output").textContent = "";

  $("log").textContent = "";
  log("Reset — ready to start over");
};

window.prefillCard = function () {
  const val = $("test-card").value;
  if (!val) return;
  const [pan, cvv] = val.split("|");
  $("pan").value = pan;
  $("cvv").value = cvv;
};

window.toggleStep = function (stepNum) {
  const el = $(`step-${stepNum}`);
  if (el.classList.contains("disabled")) return;
  el.classList.toggle("active");
};
