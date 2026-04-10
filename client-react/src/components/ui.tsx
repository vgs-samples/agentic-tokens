import type { ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex-1">
      <label className="block text-xs text-gray-500 mt-2 mb-0.5">{label}</label>
      {children}
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="flex gap-3">{children}</div>;
}

export function Button({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      className="mt-3 px-5 py-2 bg-blue-500 text-white rounded cursor-pointer text-sm hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
