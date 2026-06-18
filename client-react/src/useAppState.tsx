import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { DEFAULT_NETWORK, FLOWS, type Network, type StepKey } from "./flow";

export type { Network, StepKey } from "./flow";

export interface AppState {
  cardId: string | null;
  tokenId: string | null;
  intentId: string | null;
  assuranceData: unknown[] | null;
  /** Resolved card network — drives which steps are shown. Defaults to visa. */
  network: Network;
  /** Which step is currently active */
  activeStep: StepKey;
  /** Steps that have been completed */
  completedSteps: Set<StepKey>;
  /** Steps currently loading */
  loadingSteps: Set<StepKey>;
}

function initialState(): AppState {
  return {
    cardId: null,
    tokenId: null,
    intentId: null,
    assuranceData: null,
    network: DEFAULT_NETWORK,
    activeStep: "card",
    completedSteps: new Set(),
    loadingSteps: new Set(),
  };
}

export type LogFn = (msg: string) => void;

interface AppStateContextValue {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  logs: string[];
  log: LogFn;
  setLoading: (step: StepKey, on: boolean) => void;
  completeStep: (step: StepKey) => void;
  goToStep: (step: StepKey) => void;
  reset: () => void;
  sessionRef: RefObject<unknown>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [logs, setLogs] = useState<string[]>([]);
  const sessionRef = useRef<unknown>(null);

  const log: LogFn = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${ts}] ${msg}`]);
  }, []);

  const setLoading = useCallback((step: StepKey, on: boolean) => {
    setState((s) => {
      const next = new Set(s.loadingSteps);
      if (on) next.add(step);
      else next.delete(step);
      return { ...s, loadingSteps: next };
    });
  }, []);

  const completeStep = useCallback((step: StepKey) => {
    setState((s) => {
      const completed = new Set(s.completedSteps);
      completed.add(step);
      const loading = new Set(s.loadingSteps);
      loading.delete(step);
      const flow = FLOWS[s.network];
      const idx = flow.indexOf(step);
      // Advance to the next step in the active flow; stay put on the last step.
      const next = idx >= 0 && idx + 1 < flow.length ? flow[idx + 1] : step;
      return {
        ...s,
        completedSteps: completed,
        loadingSteps: loading,
        activeStep: next,
      };
    });
  }, []);

  const goToStep = useCallback((step: StepKey) => {
    setState((s) => (s.activeStep === step ? s : { ...s, activeStep: step }));
  }, []);

  const reset = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionRef.current as any;
    if (session?.destroy) session.destroy();
    sessionRef.current = null;
    setState(initialState());
    setLogs([]);
  }, []);

  return (
    <AppStateContext.Provider
      value={{ state, setState, logs, log, setLoading, completeStep, goToStep, reset, sessionRef }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStepStatus(step: StepKey) {
  const { state } = useAppState();
  const flow = FLOWS[state.network];
  const stepIdx = flow.indexOf(step);
  const activeIdx = flow.indexOf(state.activeStep);
  const done = state.completedSteps.has(step);
  const loading = state.loadingSteps.has(step);
  const active = state.activeStep === step;
  // A step is disabled if it isn't part of the active flow, or it's still ahead
  // of the active step (and not already completed).
  const disabled = !done && (stepIdx === -1 || activeIdx < stepIdx);
  // 1-based display number within the active flow (0 if not part of it).
  const num = stepIdx === -1 ? 0 : stepIdx + 1;
  return { active, done, loading, disabled, num, inFlow: stepIdx !== -1 };
}
