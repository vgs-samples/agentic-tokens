// Ambient declarations for VGS Collect.js v4 loaded via <script> in index.html.
// Surface covers what this app uses: async session() bootstrap, typed field methods,
// and the createCard() submission flow.

type VgsCollectCss = Record<string, Record<string, string> | string>;

interface VgsCollectFieldBaseOptions {
  placeholder?: string;
  css?: VgsCollectCss;
  classes?: Record<string, string>;
  successColor?: string;
  errorColor?: string;
  prefillValue?: string;
}

interface VgsCollectCardNumberOptions extends VgsCollectFieldBaseOptions {
  showCardIcon?: boolean;
  validations?: string[];
}

interface VgsCollectCardExpirationOptions extends VgsCollectFieldBaseOptions {
  yearLength?: 2 | 4;
  validations?: string[];
}

interface VgsCollectCardCVCOptions extends VgsCollectFieldBaseOptions {
  validations?: string[];
}

interface VgsCollectField {
  // Tears down the field's iframe and removes it from the DOM.
  delete(): void;
  update(opts: Partial<VgsCollectFieldBaseOptions>): void;
  // Resolves once the iframe has loaded and the field is mounted.
  promise: Promise<void>;
  // Triggers prefill using the value passed at field creation.
  prefill(): void;
}

interface VgsCollectFieldState {
  isValid: boolean;
  isDirty: boolean;
  isEmpty: boolean;
  errorMessages?: string[];
}

// Shape returned by form.createCard() — wraps the VGS CMP response.
// HTTP status sits at the top level; the JSON:API resource lives at data.data.
interface VgsCollectCardResult {
  status: number;
  data: {
    data: {
      id: string;
      type: string;
      attributes?: object;
      meta?: object;
    };
    metadata?: object;
  };
}

interface VgsCollectForm {
  cardNumberField(selector: string, options?: VgsCollectCardNumberOptions): VgsCollectField;
  cardCVCField(selector: string, options?: VgsCollectCardCVCOptions): VgsCollectField;
  cardExpirationDateField(selector: string, options?: VgsCollectCardExpirationOptions): VgsCollectField;
  // Submits the collected fields and creates a card via VGS CMP.
  // Access token is supplied by the authHandler passed to VGSCollect.session().
  createCard(options?: { idempotencyKey?: string }): Promise<VgsCollectCardResult>;
  reset?(): void;
  destroy?(): void;
  state: Record<string, VgsCollectFieldState>;
}

interface VgsCollectSessionOptions {
  vaultId: string;
  env: string;
  // Called by Collect when it needs a Bearer token for protected calls
  // (e.g. createCard). Return the token string; refresh logic lives here.
  authHandler?: () => Promise<string>;
  stateCallback?: (state: VgsCollectForm["state"]) => void;
}

interface VgsCollectStatic {
  session(options: VgsCollectSessionOptions): Promise<VgsCollectForm>;
}

interface Window {
  VGSCollect: VgsCollectStatic;
}
