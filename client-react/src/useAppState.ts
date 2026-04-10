import { useCallback, useRef, useState } from "react";

export interface AppState {
  cardId: string | null;
  tokenId: string | null;
  intentId: string | null;
  assuranceData: unknown[] | null;
  /** Which step (1-5) is currently active */
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

export interface StepProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  log: LogFn;
  setLoading: (step: number, on: boolean) => void;
  completeStep: (step: number) => void;
}

export function useStepStatus(state: AppState, step: number) {
  const done = state.completedSteps.has(step);
  const loading = state.loadingSteps.has(step);
  const disabled = !done && state.activeStep < step;
  return { done, loading, disabled };
}

export function useAppState() {
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
      on ? next.add(step) : next.delete(step);
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

  const reset = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = sessionRef.current as any;
    if (session?.destroy) session.destroy();
    sessionRef.current = null;
    setState(initialState());
    setLogs([]);
  }, []);

  return { state, setState, logs, log, setLoading, completeStep, reset, sessionRef };
}
