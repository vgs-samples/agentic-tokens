// Ambient declarations for VGS Collect.js v4 loaded via <script> in index.html.
// Surface kept minimal — covers only what this app uses (session() + createCard()).

interface VgsCollectFieldOptions {
  type: "card-number" | "card-security-code" | "card-expiration-date" | "text";
  name?: string;
  placeholder?: string;
  validations?: string[];
  css?: Record<string, Record<string, string> | string>;
  classes?: Record<string, string>;
  successColor?: string;
  errorColor?: string;
  showCardIcon?: boolean;
  yearLength?: number;
}

interface VgsCollectField {
  delete(): void;
  update(opts: Partial<VgsCollectFieldOptions>): void;
}

interface VgsCollectCardResult {
  id: string;
  // VGS may return additional attributes (e.g. last4, brand) — left loose on purpose.
  [key: string]: unknown;
}

interface VgsCollectSession {
  createCard(options?: { idempotencyKey?: string }): Promise<VgsCollectCardResult>;
}

interface VgsCollectForm {
  field(selector: string, options: VgsCollectFieldOptions): VgsCollectField;
  session(options: { accessToken: string }): VgsCollectSession;
  reset(): void;
  destroy?(): void;
  state: Record<string, { isValid: boolean; isDirty: boolean; isEmpty: boolean; errorMessages?: string[] }>;
}

interface VgsCollectStatic {
  create(
    vaultId: string,
    environment: string,
    stateCallback?: (state: VgsCollectForm["state"]) => void,
  ): VgsCollectForm;
}

interface Window {
  VGSCollect: VgsCollectStatic;
}
