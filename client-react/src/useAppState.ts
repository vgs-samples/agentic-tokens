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

const INITIAL: AppState = {
  cardId: null,
  tokenId: null,
  intentId: null,
  assuranceData: null,
  activeStep: 1,
  completedSteps: new Set(),
  loadingSteps: new Set(),
};

export type LogFn = (msg: string) => void;

export function useAppState() {
  const [state, setState] = useState<AppState>(INITIAL);
  const [logs, setLogs] = useState<string[]>([]);
  // Session ref — not rendered, but needed across step 3 callbacks
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
    setState(INITIAL);
    setLogs([]);
  }, []);

  return { state, setState, logs, log, setLoading, completeStep, reset, sessionRef };
}
