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

export function Button({
  onClick,
  disabled,
  children,
  variant = "primary",
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const styles =
    variant === "secondary"
      ? "bg-gray-500 text-white hover:bg-gray-600 disabled:bg-gray-300"
      : "bg-blue-500 text-white hover:bg-blue-600 disabled:bg-blue-300";
  return (
    <button
      className={`mt-3 px-5 py-2 rounded cursor-pointer text-sm disabled:cursor-not-allowed ${styles}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
