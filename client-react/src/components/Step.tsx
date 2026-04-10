import { type ReactNode, useState } from "react";

interface StepProps {
  num: number;
  title: string;
  active: boolean;
  done: boolean;
  loading: boolean;
  disabled: boolean;
  children: ReactNode;
  response?: unknown;
}

export function Step({ num, title, active, done, loading, disabled, children, response }: StepProps) {
  const [collapsed, setCollapsed] = useState(false);
  const open = active && !collapsed;

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
      disabled ? "opacity-50 pointer-events-none" : "",
      done ? "border-green-500" : "border-gray-300",
    ].join(" ")}>
      <div
        className="flex items-center gap-2.5 px-4 py-3.5 cursor-pointer select-none font-semibold"
        onClick={() => !disabled && setCollapsed((c) => !c)}
      >
        <span className={numClasses}>{loading ? "" : num}</span>
        {title}
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {children}
          {response != null && (
            <pre className="mt-3 bg-[#1e1e1e] text-[#d4d4d4] p-3 rounded text-xs max-h-72 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(response, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
