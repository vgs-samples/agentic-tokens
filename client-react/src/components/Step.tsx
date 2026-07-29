import { type ReactNode, useState } from "react";
import { useAppState, useStepStatus, type StepKey } from "../useAppState";

interface StepProps {
  stepKey: StepKey;
  title: string;
  children: ReactNode;
  response?: unknown;
  responseMeta?: string | null;
}

export function Step({ stepKey, title, children, response, responseMeta }: StepProps) {
  const { goToStep } = useAppState();
  const { active, done, loading, disabled, num, inFlow } = useStepStatus(stepKey);
  const [collapsed, setCollapsed] = useState(false);
  const open = active && !collapsed;

  // App.tsx only mounts the steps the active flow contains, so this is a backstop for a
  // step component rendered directly (e.g. device binding on a Mastercard card).
  if (!inFlow) return null;

  function handleHeaderClick() {
    if (active) {
      setCollapsed((c) => !c);
    } else {
      goToStep(stepKey);
    }
  }

  const numClasses = [
    "w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0",
    done ? "bg-green-500 text-white" :
    loading ? "border-3 border-gray-200 border-t-blue-500 animate-spin text-transparent" :
    active ? "bg-blue-500 text-white" :
    "bg-gray-200 text-gray-700",
  ].join(" ");

  return (
    <div className={[
      "bg-white border rounded-lg mb-3 overflow-visible",
      disabled ? "opacity-60" : "",
      done ? "border-green-500" : "border-gray-300",
    ].join(" ")}>
      <div
        className="flex items-center gap-2.5 px-4 py-3.5 cursor-pointer select-none font-semibold"
        onClick={handleHeaderClick}
      >
        <span className={numClasses}>{loading ? "" : num}</span>
        {title}
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {children}
          {response != null && (
            <div className="mt-3 overflow-hidden rounded border border-gray-800 bg-[#1e1e1e]">
              {responseMeta && (
                <div className="border-b border-gray-700 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-300">
                  {responseMeta}
                </div>
              )}
              <pre className="text-[#d4d4d4] p-3 text-xs max-h-72 overflow-auto whitespace-pre-wrap break-all m-0">
                {typeof response === "string" ? response : JSON.stringify(response, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
