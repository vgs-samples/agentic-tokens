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

export interface AppState {
  cardId: string | null;
  tokenId: string | null;
  intentId: string | null;
  assuranceData: unknown[] | null;
  /** Which step (1-6) is currently active */
  activeStep: number;
  /** Steps that have been completed */
  completedSteps: Set<number>;
  /** Steps currently loading */
  loadingSteps: Set<number>;
}

function initialState(): AppState {
  return {
    cardId: null,
    tokenId: null,
    intentId: null,
    assuranceData: null,
    activeStep: 1,
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
  setLoading: (step: number, on: boolean) => void;
  completeStep: (step: number) => void;
  goToStep: (step: number) => void;
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

  const setLoading = useCallback((step: number, on: boolean) => {
    setState((s) => {
      const next = new Set(s.loadingSteps);
      if (on) next.add(step);
      else next.delete(step);
      return { ...s, loadingSteps: next };
    });
  }, []);

  const completeStep = useCallback((step: number) => {
    setState((s) => {
      const completed = new Set(s.completedSteps);
      completed.add(step);
      const loading = new Set(s.loadingSteps);
      loading.delete(step);
      return {
        ...s,
        completedSteps: completed,
        loadingSteps: loading,
        activeStep: step + 1,
      };
    });
  }, []);

  const goToStep = useCallback((step: number) => {
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
export function useStepStatus(step: number) {
  const { state } = useAppState();
  const done = state.completedSteps.has(step);
  const loading = state.loadingSteps.has(step);
  const active = state.activeStep === step;
  const disabled = !done && state.activeStep < step;
  return { active, done, loading, disabled };
}
