/**
 * VgsAgenticAuth — client-side library for Visa device binding.
 *
 * Wraps the iframe lifecycle, postMessage flow, API calls, and assuranceData
 * transformation into a simple 3-step API:
 *
 *   const flow = new VgsAgenticAuth({ tokenId, apiBase });
 *   const session = await flow.startSession(container);
 *   if (session.needsOtp) await session.submitOtp("123456");
 *   const assuranceData = await session.authenticate();
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
    apiKey: "WJHJ5RL6IHGG1OIRKWML21B9ihFOrGC-unbUUwYmPqRPF3YGs",
  },
  sandbox: {
    apiBase: "https://gw-01-sandbox.vgsapi.com",
    iframeOrigin: "https://sbx.vts.auth.visa.com",
    apiKey: "WJHJ5RL6IHGG1OIRKWML21B9ihFOrGC-unbUUwYmPqRPF3YGs",
  },
  live: {
    apiBase: "https://vgsapi.com",
    iframeOrigin: "https://vts.auth.visa.com",
    apiKey: "WJHJ5RL6IHGG1OIRKWML21B9ihFOrGC-unbUUwYmPqRPF3YGs",
  },
};

const CLIENT_APP_ID = "VGSVicProvisionToken";

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
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "VgsAgenticAuthError";
    this.status = status ?? null;
    this.code = code ?? null;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function _postJson(apiBase, path, body, accessToken) {
  const url = `${apiBase}${path}`;
  const headers = { "Content-Type": "application/vnd.api+json" };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
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
function _waitForIframeMessage(origin, expectedType, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;

    function handler(event) {
      if (event.origin !== origin) return;
      if (event.data?.type !== expectedType) return;
      cleanup();
      resolve(event.data);
    }

    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("message", handler);
    }

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

/**
 * Create a hidden Visa VTS auth iframe and append it to a container.
 * Returns the iframe element once it has been added to the DOM.
 */
function _createIframe(container, origin, apiKey) {
  const src = `${origin}/vts-auth/authenticate?apiKey=${apiKey}&clientAppID=${CLIENT_APP_ID}`;
  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.width = "0";
  iframe.height = "0";
  iframe.style.border = "none";
  iframe.allow = "publickey-credentials-get *; publickey-credentials-create *";
  container.appendChild(iframe);
  return iframe;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

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
  ) {
    this._config = config;
    this._iframeEl = iframeEl;
    this._requestID = requestID;
    this._sessionContext = sessionContext;
    this._browserData = browserData;
    this._dfpSessionID = dfpSessionID;
    this._authContext = null;
    this._sessionClosed = false;

    const attrs = attestationResult.data.attributes;
    if (
      attrs.status === "CHALLENGE" &&
      Array.isArray(attrs.stepUpRequest)
    ) {
      this._state = STATE_OTP_PENDING;
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
   * Submit an OTP code. Only callable when `needsOtp` is true.
   * Selects the first OTPSMS method (or first available method) and submits the code.
   * @param {string} code  The OTP code entered by the cardholder
   */
  async submitOtp(code) {
    this._guardState(STATE_OTP_PENDING, "submitOtp");

    if (!code || typeof code !== "string") {
      throw new VgsAgenticAuthError("OTP code must be a non-empty string");
    }

    // Pick the best OTP method (prefer OTPSMS)
    const method =
      this.otpMethods.find((m) => m.method === "OTPSMS") ||
      this.otpMethods[0];
    if (!method) {
      throw new VgsAgenticAuthError("No OTP methods available");
    }

    // Step 1: select the OTP delivery method
    await _postJson(this._config.apiBase, `/agentic-tokens/${this._config.tokenId}/otp/${method.identifier}`, {
      data: {
        type: "otp_methods",
        attributes: { client_ref_id: this._config.clientRefId },
      },
    }, this._config.accessToken);

    // Step 2: submit the code
    const result = await _postJson(this._config.apiBase, `/agentic-tokens/${this._config.tokenId}/otp`, {
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
    }, this._config.accessToken);

    this._authContext = result.data.attributes.authenticationContext;
    this._state = STATE_READY;
  }

  /**
   * Run the FIDO ceremony in the iframe and return the transformed assuranceData.
   * @returns {Promise<Array>}  Ready-to-use assuranceData for intent creation
   */
  async authenticate() {
    this._guardState(STATE_READY, "authenticate");

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
    if (this._state !== expected) {
      throw new VgsAgenticAuthError(
        `Cannot call ${method}() in state "${this._state}" (expected "${expected}")`,
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
   * @param {string} options.consumerEmail Consumer email address for identity verification
   * @param {string} [options.accessToken] Bearer token for API authentication
   * @param {string} [options.clientRefId] Unique trace ID (auto-generated if omitted)
   * @param {number} [options.timeout]     Timeout in ms for iframe operations (default 30000)
   */
  constructor({ tokenId, environment, consumerEmail, accessToken, clientRefId, timeout } = {}) {
    if (!tokenId) throw new VgsAgenticAuthError("tokenId is required");
    if (!environment) throw new VgsAgenticAuthError("environment is required");
    if (!consumerEmail) throw new VgsAgenticAuthError("consumerEmail is required");

    const env = ENVIRONMENTS[environment];
    if (!env) {
      throw new VgsAgenticAuthError(
        `Unknown environment "${environment}". Use "sandbox" or "live".`,
      );
    }

    this.tokenId = tokenId;
    this.consumerEmail = consumerEmail;
    this.apiBase = env.apiBase;
    this.accessToken = accessToken || null;
    this.clientRefId = clientRefId || crypto.randomUUID();
    this.timeout = timeout ?? 30_000;
    this._iframeOrigin = env.iframeOrigin;
    this._apiKey = env.apiKey;
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
  async startSession(container) {
    container = container || document.body;

    // Create iframe and start listening for AUTH_READY before it loads
    const readyPromise = _waitForIframeMessage(
      this._iframeOrigin,
      "AUTH_READY",
      this.timeout,
    );

    const iframeEl = _createIframe(container, this._iframeOrigin, this._apiKey);

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
      attestationResult = await _postJson(
        this.apiBase,
        `/agentic-tokens/${this.tokenId}/device-attestations`,
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
            },
          },
        },
        this.accessToken,
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

    return new Session(
      this,
      iframeEl,
      requestID,
      sessionContext,
      browserData,
      dfpSessionID || "",
      attestationResult,
    );
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { VgsAgenticAuth, VgsAgenticAuthError };
