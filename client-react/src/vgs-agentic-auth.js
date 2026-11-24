/**
 * VgsAgenticAuth — browser verification for Visa and Mastercard.
 *
 * Wraps the iframe lifecycle, postMessage flow, API calls, and assuranceData
 * transformation into a simple step-by-step API:
 *
 *   const flow = new VgsAgenticAuth({ tokenId, environment, consumerEmail });
 *   const session = await flow.startSession(container);
 *   if (session.needsOtp) {
 *     // integrator picks one of session.otpMethods (e.g. via UI)
 *     await session.requestOtp(chosenMethod);
 *     await session.submitOtp("456789");
 *   }
 *   if (session.needsPasskey) {
 *     // reveal session.iframe for the passkey ceremony
 *   }
 *   const assuranceData = await session.authenticate();
 *
 * Unified browser verification:
 *   const { assuranceData } = await flow.verify({ container, method, onChallenge, signal });
 * Mastercard uses the selected 3DS method and enrollment clientRefId; Visa can discover
 * an OTP challenge through onChallenge(session). Window protocols stay inside this SDK.
 *
 * The flow (OTP and/or passkey) is driven by the server: `needsOtp` and `needsPasskey`
 * come from the device-attestation response. A passkey-exempt tenant reports
 * `needsPasskey === false`; authenticate() then resolves without a passkey ceremony.
 *
 * @module vgs-agentic-auth
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENVIRONMENTS = {
  // Internal only — for local development. Not publicly documented.
  local: {
    apiBase: "http://localhost:8081",
    iframeOrigin: "https://sbx.vts.auth.visa.com",
    // public api key
    apiKey: "WJHJ5RL6IHGG1OIRKWML21B9ihFOrGC-unbUUwYmPqRPF3YGs",
  },
  // Internal only. Not publicly documented.
  dev: {
    apiBase: "https://gw-01-sandbox.vgsapi.io",
    iframeOrigin: "https://sbx.vts.auth.visa.com",
    // public api key
    apiKey: "WJHJ5RL6IHGG1OIRKWML21B9ihFOrGC-unbUUwYmPqRPF3YGs",
  },
  sandbox: {
    apiBase: "https://gw-01-sandbox.vgsapi.com",
    iframeOrigin: "https://sbx.vts.auth.visa.com",
    // public api key
    apiKey: "WJHJ5RL6IHGG1OIRKWML21B9ihFOrGC-unbUUwYmPqRPF3YGs",
  },
  live: {
    apiBase: "https://gw-01-live.vgsapi.com",
    iframeOrigin: "https://vts.auth.visa.com",
    // public api key
    apiKey: "G908GCRYXDB09PTM2UCE21sH3cY2Sw4R2xovFpG5JDF57i-FQ"
  },
};

// const CLIENT_APP_ID = "VGSVicProvisionToken";
const CLIENT_APP_ID = "VGS";

// Sample-app only: the demo renders the Visa passkey prompt inline.
const VISA_IFRAME_WIDTH = "390";
const VISA_IFRAME_HEIGHT = "400";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

class VgsAgenticAuthError extends Error {
  /**
   * @param {string} message
   * @param {object} [opts]
   * @param {number} [opts.status]  HTTP status (when error originates from API)
   * @param {string} [opts.code]    Machine-readable error code from API
   */
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = "VgsAgenticAuthError";
    this.status = status ?? null;
    this.code = code ?? null;
    this.body = body;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function _requestJson(apiBase, method, path, body, accessToken, { signal } = {}) {
  const url = `${apiBase}${path}`;
  const headers = { "Content-Type": "application/vnd.api+json" };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw _cancelled();
    throw new VgsAgenticAuthError(`Network error: ${err.message}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.detail || data?.error || res.statusText;
    throw new VgsAgenticAuthError(`API ${res.status}: ${msg}`, {
      status: res.status,
      code: data?.error,
      body: data,
    });
  }
  return data;
}

function _sendIframeCommand(iframeEl, origin, requestID, extra) {
  const command = {
    requestID,
    version: "1",
    contentType: "application/json",
    ...extra,
  };
  iframeEl.contentWindow.postMessage(command, origin);
}

/**
 * Listen for a single iframe postMessage of a given type.
 * Resolves with event.data. Rejects on timeout. Cleans up automatically.
 */
function _waitForIframeMessage(origin, expectedType, timeoutMs, { signal, source } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    if (signal?.aborted) { reject(_cancelled()); return; }

    function aborted() { cleanup(); reject(_cancelled()); }
    function handler(event) {
      if (event.origin !== origin || (source && event.source !== source())) return;
      if (event.data?.type !== expectedType) return;
      cleanup();
      resolve(event.data);
    }

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("message", handler);
      signal?.removeEventListener("abort", aborted);
    }

    signal?.addEventListener("abort", aborted, { once: true });
    window.addEventListener("message", handler);
    timer = setTimeout(() => {
      cleanup();
      reject(
        new VgsAgenticAuthError(
          `Timeout waiting for iframe message "${expectedType}" (${timeoutMs}ms)`,
        ),
      );
    }, timeoutMs);
  });
}

function _transformAssuranceData(rawAssurance, dfpSessionID) {
  return [
    {
      methodResults: {
        identifier: rawAssurance.identifier || "",
        dfpSessionId: dfpSessionID,
        fidoAssertionData: { code: rawAssurance.fidoBlob || "" },
      },
      verificationType: "DEVICE",
      verificationResults: "01",
      verificationMethod: "23",
      verificationTimestamp: String(Math.floor(Date.now() / 1000)),
    },
  ];
}

function _cancelled() {
  return new VgsAgenticAuthError("Verification was cancelled.", { code: "verification_cancelled" });
}

function _withAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(_cancelled());
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

const _record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function _authUiUrl(value, browserOrigin) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["sandbox.src.mastercard.com", "src.mastercard.com"].includes(url.hostname)
    || url.port || url.username || url.password || url.pathname !== "/auth" || url.hash
    || url.searchParams.get("origin") !== browserOrigin || [...url.searchParams.keys()].length !== 1) {
    throw new VgsAgenticAuthError("The API did not return a trusted Mastercard verification URL.");
  }
  return url;
}

function readAuthenticationUiPreparation(body, tokenId, identifier, browserOrigin) {
  const resource = body?.data;
  const attrs = resource?.attributes;
  const context = attrs?.authenticationContext;
  if (resource?.type !== "otp_methods" || resource.id !== identifier || attrs?.method !== "3DS" || !_record(context)) {
    throw new VgsAgenticAuthError("The API did not return browser verification context.");
  }
  const payload = context.authentication_payload;
  if (typeof context.launch_uri !== "string" || !_record(payload)
    || payload.accountReference?.srcDigitalCardId !== tokenId
    || payload.authenticationMethod?.authenticationMethodType !== "3DS"
    || payload.authenticationMethod.authenticationSubject !== "CARDHOLDER"
    || typeof payload.srcCorrelationId !== "string" || !payload.srcCorrelationId
    || typeof payload.traceId !== "string" || !payload.traceId) {
    throw new VgsAgenticAuthError("Mastercard verification preparation does not match this card.");
  }
  _authUiUrl(context.launch_uri, browserOrigin);
  return { launch_uri: context.launch_uri, authentication_payload: payload };
}

function readThreeDsResult(value, prepared) {
  const expected = prepared.authentication_payload;
  if (!_record(value) || value.srcCorrelationId !== expected.srcCorrelationId
    || (value.traceId != null && value.traceId !== expected.traceId)
    || (expected.srciTransactionId != null && value.srciTransactionId !== expected.srciTransactionId)
    || (_record(value.accountReference)
      && value.accountReference.srcDigitalCardId !== expected.accountReference.srcDigitalCardId)) {
    throw new VgsAgenticAuthError("Mastercard returned a mismatched verification result. Start a new verification.");
  }
  if (value.authenticationStatus !== "COMPLETE" || value.authenticationResult !== "AUTHENTICATED") {
    throw new VgsAgenticAuthError("Bank verification was not completed successfully. You can try again.");
  }
  const assurance = value.assuranceData;
  if (!_record(assurance) || !Array.isArray(assurance.verificationData)
    || !assurance.verificationData.every(_record) || !assurance.verificationData.some((proof) =>
      proof.verificationType === "CARDHOLDER" && proof.verificationEntity === "03" && proof.verificationMethod === "01"
      && proof.verificationResults === "01" && typeof proof.additionalData === "string" && proof.additionalData.trim())) {
    throw new VgsAgenticAuthError("Mastercard did not return a successful 3DS verification proof.");
  }
  return assurance;
}

/** Open synchronously from the user's click, before awaiting API preparation. */
function launchThreeDs(host, prepare, browserOrigin, onExchange = () => {}, { signal, timeout = 600_000 } = {}) {
  if (signal?.aborted) throw _cancelled();
  const popup = host.open("about:blank", "_blank", "popup,width=480,height=720");
  if (!popup) throw new VgsAgenticAuthError("Allow popups for this site to open bank verification.");
  let settled = false;
  let initialized = false;
  let preparation;
  let expectedOrigin = "";
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const cancelled = () => finish(_cancelled());
  function finish(error, value) {
    if (settled) return;
    settled = true;
    host.removeEventListener("message", onMessage);
    signal?.removeEventListener("abort", cancelled);
    host.clearInterval(closedTimer); host.clearTimeout(timeoutTimer);
    try { if (!popup.closed) popup.close(); } catch { /* Window may already be gone. */ }
    if (error) rejectResult(error); else resolveResult(value);
  }
  function onMessage(event) {
    if (settled || !preparation || event.source !== popup || event.origin !== expectedOrigin || !_record(event.data)) return;
    if (event.data.action === "Ready" && !initialized) {
      initialized = true;
      const message = { action: "Authenticate", payload: preparation.authentication_payload };
      try { popup.postMessage(message, expectedOrigin); onExchange(message); }
      catch { finish(new VgsAgenticAuthError("Could not initialize Mastercard verification.")); }
    } else if (initialized && ["Success", "Error"].includes(event.data.action)) {
      try {
        onExchange(event.data);
        if (event.data.action === "Error") throw new VgsAgenticAuthError("Mastercard verification failed.");
        finish(undefined, { raw: event.data.payload, assuranceData: readThreeDsResult(event.data.payload, preparation) });
      } catch (error) { finish(error); }
    }
  }
  host.addEventListener("message", onMessage);
  const closedTimer = host.setInterval(() => {
    if (popup.closed) finish(new VgsAgenticAuthError("The bank verification window was closed. You can try again."));
  }, 500);
  const timeoutTimer = host.setTimeout(() => finish(new VgsAgenticAuthError("Bank verification timed out.")), timeout);
  signal?.addEventListener("abort", cancelled, { once: true });
  if (signal?.aborted) cancelled();
  if (!settled) void (async () => {
    try {
      const prepared = await prepare();
      if (settled) return;
      const url = _authUiUrl(prepared.launch_uri, browserOrigin);
      preparation = prepared; expectedOrigin = url.origin;
      popup.location.replace(url.href);
    } catch (error) { finish(error); }
  })();
  return { result, cancel: cancelled };
}

/**
 * Create a hidden Visa VTS auth iframe and append it to a container.
 * Returns the iframe element once it has been added to the DOM.
 */
function _createIframe(container, origin, apiKey) {
  const src = `${origin}/vts-auth/authenticate?apiKey=${apiKey}&clientAppID=${CLIENT_APP_ID}`;
  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.title = "Visa authentication";
  iframe.width = VISA_IFRAME_WIDTH;
  iframe.height = VISA_IFRAME_HEIGHT;
  iframe.style.display = "block";
  iframe.style.width = "100%";
  iframe.style.maxWidth = `${VISA_IFRAME_WIDTH}px`;
  iframe.style.height = `${VISA_IFRAME_HEIGHT}px`;
  iframe.style.border = "none";
  iframe.allow = "publickey-credentials-get *; publickey-credentials-create *";
  container.appendChild(iframe);
  return iframe;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const STATE_OTP_METHOD_PENDING = "otp_method_pending";
const STATE_OTP_PENDING = "otp_pending";
const STATE_READY = "ready";
const STATE_AUTHENTICATING = "authenticating";
const STATE_COMPLETE = "complete";
const STATE_DESTROYED = "destroyed";

class Session {
  /**
   * @param {object} config        VgsAgenticAuth config
   * @param {HTMLIFrameElement} iframeEl
   * @param {string} requestID     From AUTH_READY
   * @param {object} sessionContext From AUTH_SESSION_CREATED (Visa pass-through)
   * @param {object} browserData   From AUTH_SESSION_CREATED (Visa pass-through)
   * @param {string} dfpSessionID  From AUTH_SESSION_CREATED
   * @param {object} attestationResult  Response from /device-attestations
   */
  constructor(
    config,
    iframeEl,
    requestID,
    sessionContext,
    browserData,
    dfpSessionID,
    attestationResult,
    signal,
  ) {
    this._config = config;
    this._iframeEl = iframeEl;
    this._requestID = requestID;
    this._sessionContext = sessionContext;
    this._browserData = browserData;
    this._dfpSessionID = dfpSessionID;
    this._authContext = null;
    this._sessionClosed = false;
    this._signal = signal;
    this._raw = attestationResult;

    const attrs = attestationResult.data.attributes;

    // Server-driven flow selection: the attestation response tells us whether the
    // passkey ceremony is required for this tenant. Defaults to true when the field is
    // absent, so older backends and default tenants keep the full-FIDO behavior.
    this.needsPasskey = attrs.passkey_required !== false;

    if (
      attrs.status === "CHALLENGE" &&
      Array.isArray(attrs.stepUpRequest)
    ) {
      this._state = STATE_OTP_METHOD_PENDING;
      this.needsOtp = true;
      this.otpMethods = attrs.stepUpRequest;
    } else {
      this._state = STATE_READY;
      this.needsOtp = false;
      this.otpMethods = [];
      this._authContext = attrs.authenticationContext;
    }
  }

  /**
   * The library-managed iframe element.
   * Useful for showing/hiding during the FIDO ceremony (e.g. iframe.width = 300).
   * @type {HTMLIFrameElement}
   */
  get iframe() {
    return this._iframeEl;
  }

  /**
   * Request OTP delivery via the chosen method.
   *
   * Only callable when `needsOtp` is true. The integrator must pick one of
   * `session.otpMethods` (the list returned from device attestation) and pass
   * the full method object here.
   *
   * Re-callable: while OTP is pending, call this again to resend, or pass a
   * different method to switch channel (e.g. SMS → email).
   *
   * @param {object} method  One of `session.otpMethods` — must include `identifier`
   */
  async requestOtp(method) {
    this._guardState(
      [STATE_OTP_METHOD_PENDING, STATE_OTP_PENDING],
      "requestOtp",
    );

    if (!method || !method.identifier) {
      throw new VgsAgenticAuthError(
        "requestOtp requires a method object with an identifier (use one of session.otpMethods)",
      );
    }

    const known = this.otpMethods.some(
      (m) => m.identifier === method.identifier,
    );
    if (!known) {
      throw new VgsAgenticAuthError(
        "Unknown OTP method (not in session.otpMethods)",
      );
    }

    await this._config._request(
      "POST",
      `/agentic-tokens/${encodeURIComponent(this._config.tokenId)}/otp/${encodeURIComponent(method.identifier)}`,
      {
        data: {
          type: "otp_methods",
          attributes: { client_ref_id: this._config.clientRefId },
        },
      },
      { signal: this._signal },
    );

    this._state = STATE_OTP_PENDING;
  }

  /**
   * Submit an OTP code. Must be called after `requestOtp` has triggered delivery.
   * @param {string} code  The OTP code entered by the cardholder
   */
  async submitOtp(code) {
    this._guardState(STATE_OTP_PENDING, "submitOtp");

    if (!code || typeof code !== "string") {
      throw new VgsAgenticAuthError("OTP code must be a non-empty string");
    }

    const result = await this._config._request("POST", `/agentic-tokens/${encodeURIComponent(this._config.tokenId)}/otp`, {
      data: {
        type: "otp_submissions",
        attributes: {
          otp: code,
          client_ref_id: this._config.clientRefId,
          consumer_email: this._config.consumerEmail,
          session_context: this._sessionContext,
          browser_data: this._browserData,
        },
      },
    }, { signal: this._signal });

    const attrs = result?.data?.attributes;
    if (!attrs || (!this.needsPasskey && !["VALIDATED", "APPROVED", "AUTHENTICATED", "ACTIVE"].includes(attrs.status))
      || ["PENDING", "PENDING_STEP_UP", "REJECTED", "FAILED", "DECLINED", "EXPIRED"].includes(attrs.status)) {
      throw new VgsAgenticAuthError("OTP verification was not completed.");
    }
    this._raw = result;
    this._authContext = attrs.authenticationContext;
    this.needsOtp = false;
    this._state = STATE_READY;
  }

  /**
   * Run the FIDO ceremony in the iframe and return the transformed assuranceData.
   * @returns {Promise<Array>}  Ready-to-use assuranceData for intent creation
   */
  async authenticate() {
    this._guardState(STATE_READY, "authenticate");

    // Passkey-exempt tenants skip the FIDO ceremony entirely. The backend supplies the
    // assuranceData waiver for these tenants, so we return an empty array — safe to send
    // as-is. Calling authenticate() here stays valid so existing integrations that always
    // call it keep working without code changes.
    if (!this.needsPasskey) {
      this._closeSession();
      this._state = STATE_COMPLETE;
      return [];
    }

    if (!this._authContext) {
      throw new VgsAgenticAuthError(
        "No authenticationContext available. Was attestation successful?",
      );
    }

    this._state = STATE_AUTHENTICATING;

    // Start listening before sending the command to avoid race
    const authCompletePromise = _waitForIframeMessage(
      this._config._iframeOrigin,
      "AUTH_COMPLETE",
      this._config.timeout,
      { signal: this._signal, source: () => this._iframeEl.contentWindow },
    );

    _sendIframeCommand(
      this._iframeEl,
      this._config._iframeOrigin,
      this._requestID,
      {
        type: "AUTHENTICATE",
        authenticationContext: this._authContext,
      },
    );

    const data = await authCompletePromise;
    if (!data.assuranceData || typeof data.assuranceData.fidoBlob !== "string" || !data.assuranceData.fidoBlob) {
      throw new VgsAgenticAuthError("Visa did not return an authentication proof.");
    }
    this._raw = data;

    // Close the iframe session
    this._closeSession();

    const assuranceData = _transformAssuranceData(
      data.assuranceData,
      this._dfpSessionID,
    );

    this._state = STATE_COMPLETE;
    return assuranceData;
  }

  /**
   * Clean up the session. Closes the iframe auth session and removes the
   * iframe from the DOM. Safe to call multiple times.
   */
  destroy() {
    if (this._state === STATE_DESTROYED) return;
    this._closeSession();
    try {
      this._iframeEl.remove();
    } catch {
      /* ignore */
    }
    this._state = STATE_DESTROYED;
  }

  // -- internal --

  _guardState(expected, method) {
    if (this._state === STATE_DESTROYED) {
      throw new VgsAgenticAuthError("Session has been destroyed");
    }
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(this._state)) {
      throw new VgsAgenticAuthError(
        `Cannot call ${method}() in state "${this._state}" (expected ${allowed.map((s) => `"${s}"`).join(" or ")})`,
      );
    }
  }

  _closeSession() {
    if (this._sessionClosed) return;
    try {
      _sendIframeCommand(
        this._iframeEl,
        this._config._iframeOrigin,
        this._requestID,
        { type: "CLOSE_AUTH_SESSION" },
      );
    } catch {
      // iframe may already be gone — ignore
    }
    this._sessionClosed = true;
  }
}

// ---------------------------------------------------------------------------
// VgsAgenticAuth
// ---------------------------------------------------------------------------

class VgsAgenticAuth {
  /**
   * @param {object} options
   * @param {string} options.tokenId       Provisioned token ID from card enrollment
   * @param {string} options.environment   "sandbox" or "live"
   * @param {string} [options.consumerEmail] Consumer email address (required for Visa)
   * @param {string} [options.accessToken] Bearer token for API authentication
   * @param {string} [options.clientRefId] Unique trace ID (auto-generated if omitted)
   * @param {number} [options.timeout]     Timeout in ms for iframe operations (default 30000)
   * @param {number} [options.verificationTimeout] Popup timeout in ms (default 600000)
   * @param {string} [options.apiBase] Override the environment API base URL
   * @param {Function} [options.request] Optional authenticated transport: (method, path, body, {signal}) => API JSON
   */
  constructor({ tokenId, environment, consumerEmail, accessToken, clientRefId, timeout,
                authenticationAmount, currencyCode, merchantName, apiBase, request, verificationTimeout } = {}) {
    if (!tokenId) throw new VgsAgenticAuthError("tokenId is required");
    if (!environment) throw new VgsAgenticAuthError("environment is required");
    if (!consumerEmail && !clientRefId?.startsWith("vgs:ms:")) {
      throw new VgsAgenticAuthError("consumerEmail is required for Visa verification");
    }

    const env = ENVIRONMENTS[environment];
    if (!env) {
      throw new VgsAgenticAuthError(
        `Unknown environment "${environment}". Use "sandbox" or "live".`,
      );
    }

    this.tokenId = tokenId;
    this.consumerEmail = consumerEmail;
    this.apiBase = apiBase ?? env.apiBase;
    this._transport = request;
    this._verificationActive = false;
    this.accessToken = accessToken || null;
    this.clientRefId = clientRefId || crypto.randomUUID();
    this.timeout = timeout ?? 30_000;
    this.verificationTimeout = verificationTimeout ?? 600_000;
    this._iframeOrigin = env.iframeOrigin;
    this._apiKey = env.apiKey;
    this.authenticationAmount = authenticationAmount || "100";
    this.currencyCode = currencyCode || "840";
    this.merchantName = merchantName || null;
  }

  _request(method, path, body, options = {}) {
    if (options.signal?.aborted) return Promise.reject(_cancelled());
    const request = this._transport
      ? this._transport(method, path, body, options)
      : _requestJson(this.apiBase, method, path, body, this.accessToken, options);
    return _withAbort(request, options.signal);
  }

  /**
   * Verify the cardholder with one API for Visa iframe/FIDO and Mastercard popup 3DS.
   * Pass the selected lookup method for Mastercard. Visa OTP UI belongs in onChallenge(session).
   * Returns { status: "verified", assuranceData, raw }; proof stays provider-native.
   * Call directly from a click handler; an optional AbortSignal cancels and cleans up.
   * Existing startSession()/Session methods remain available for step-by-step clients.
   * @param {object} [options]
   * @param {HTMLElement} [options.container] Container for the Visa iframe
   * @param {object} [options.session] Existing Visa Session for step-by-step integrations
   * @param {object} [options.method] Selected 3DS method returned by lookup
   * @param {Function} [options.onSession] Called when the Visa session is available
   * @param {Function} [options.onChallenge] Async callback to request and submit the issuer OTP
   * @param {AbortSignal} [options.signal] Cancels the current verification
   * @param {object} [options.browser] Optional browser verification inputs
   * @param {Function} [options.onExchange] Optional protocol event observer
   */
  async verify({ container, session, method, onSession, onChallenge, signal, browser = {}, onExchange } = {}) {
    if (this._verificationActive) throw new VgsAgenticAuthError("Verification is already running.");
    if (session && session._config !== this) throw new VgsAgenticAuthError("The session belongs to another verification flow.");
    signal ??= session?._signal;
    if (signal?.aborted) throw _cancelled();
    this._verificationActive = true;
    let current = session;
    const aborted = () => current?.destroy();
    signal?.addEventListener("abort", aborted, { once: true });
    try {
      if (this.clientRefId.startsWith("vgs:ms:") || method?.method === "3DS") {
        if (!this.clientRefId.startsWith("vgs:ms:") || method?.method !== "3DS"
          || typeof method.identifier !== "string" || !method.identifier) {
          throw new VgsAgenticAuthError("Choose a 3DS method from lookup and use the enrollment client_ref_id.");
        }
        const origin = window.location.origin;
        const popup = launchThreeDs(window, async () => {
          const body = await this._request("POST",
            `/agentic-tokens/${encodeURIComponent(this.tokenId)}/otp/${encodeURIComponent(method.identifier)}`, {
              data: { type: "otp_methods", attributes: {
                ...browser,
                client_ref_id: this.clientRefId,
                browser_origin: origin,
                dpa_locale: browser.dpa_locale ?? (/^[a-z]{2}[-_][a-z]{2}$/i.test(navigator.language)
                  ? navigator.language.replace("-", "_") : "en_US"),
              } },
            }, { signal });
          return readAuthenticationUiPreparation(body, this.tokenId, method.identifier, origin);
        }, origin, onExchange, { signal, timeout: this.verificationTimeout });
        return { status: "verified", ...await popup.result };
      }
      current ??= await this.startSession(container, { signal });
      current._signal = signal;
      if (signal?.aborted) throw _cancelled();
      // The unified entry point owns presentation; legacy startSession() keeps its sizing contract.
      if (current.needsPasskey) {
        current.iframe.title = "Cardholder verification";
        current.iframe.width = "390";
        current.iframe.height = "400";
        Object.assign(current.iframe.style, { display: "block", width: "100%", maxWidth: "390px", height: "400px" });
      } else {
        current.iframe.style.display = "none";
      }
      onSession?.(current);
      if (current.needsOtp) {
        if (!onChallenge) throw new VgsAgenticAuthError("Provide onChallenge(session) to collect the issuer OTP.");
        await _withAbort(Promise.resolve(onChallenge(current)), signal);
      }
      const assuranceData = await _withAbort(current.authenticate(), signal);
      return { status: "verified", assuranceData, raw: current._raw };
    } finally {
      signal?.removeEventListener("abort", aborted);
      current?.destroy();
      this._verificationActive = false;
    }
  }

  /**
   * Start a device binding session.
   *
   * Creates the Visa iframe, waits for it to be ready, creates an auth session,
   * calls /device-attestations, and returns a Session object.
   *
   * The iframe is appended to `container` (defaults to document.body).
   * Access it via `session.iframe` to show/hide during the FIDO ceremony.
   *
   * @param {HTMLElement} [container=document.body]  Element to append the iframe to
   * @returns {Promise<Session>}
   */
  async startSession(container, { signal } = {}) {
    container = container || document.body;
    if (signal?.aborted) throw _cancelled();
    let iframeEl;

    // Create iframe and start listening for AUTH_READY before it loads
    const readyPromise = _waitForIframeMessage(
      this._iframeOrigin,
      "AUTH_READY",
      this.timeout,
      { signal, source: () => iframeEl?.contentWindow },
    );

    iframeEl = _createIframe(container, this._iframeOrigin, this._apiKey);

    let requestID;
    try {
      const readyData = await readyPromise;
      requestID = readyData.requestID;
    } catch (err) {
      iframeEl.remove();
      throw err;
    }

    // Create auth session
    _sendIframeCommand(iframeEl, this._iframeOrigin, requestID, {
      type: "CREATE_AUTH_SESSION",
    });

    let sessionData;
    try {
      sessionData = await _waitForIframeMessage(
        this._iframeOrigin,
        "AUTH_SESSION_CREATED",
        this.timeout,
        { signal, source: () => iframeEl.contentWindow },
      );
    } catch (err) {
      try {
        _sendIframeCommand(iframeEl, this._iframeOrigin, requestID, {
          type: "CLOSE_AUTH_SESSION",
        });
      } catch {
        /* ignore */
      }
      iframeEl.remove();
      throw err;
    }

    const { sessionContext, browserData, dfpSessionID } = sessionData;

    // Call device attestation API
    let attestationResult;
    try {
      attestationResult = await this._request(
        "POST",
        `/agentic-tokens/${encodeURIComponent(this.tokenId)}/device-attestations`,
        {
          data: {
            type: "device_attestations",
            attributes: {
              browserData,
              sessionContext,
              client_ref_id: this.clientRefId,
              consumer_email: this.consumerEmail,
              auth_type: "AUTHENTICATE",
              reason_code: "PAYMENT",
              authentication_amount: this.authenticationAmount,
              currency_code: this.currencyCode,
              ...(this.merchantName ? { merchant_name: this.merchantName } : {}),
            },
          },
        },
        { signal },
      );
    } catch (err) {
      try {
        _sendIframeCommand(iframeEl, this._iframeOrigin, requestID, {
          type: "CLOSE_AUTH_SESSION",
        });
      } catch {
        /* ignore */
      }
      iframeEl.remove();
      throw err;
    }

    const session = new Session(
      this,
      iframeEl,
      requestID,
      sessionContext,
      browserData,
      dfpSessionID || "",
      attestationResult,
      signal,
    );

    return session;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { VgsAgenticAuth, VgsAgenticAuthError, launchThreeDs, readAuthenticationUiPreparation, readThreeDsResult };
