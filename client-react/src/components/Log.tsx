import { useEffect, useRef } from "react";

export function Log({ entries }: { entries: string[] }) {
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [entries]);

  return (
    <details className="mt-5 bg-white border border-gray-300 rounded-lg overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer font-semibold text-sm text-gray-500 select-none">
        Log
      </summary>
      <pre ref={preRef} className="bg-[#1e1e1e] text-[#a3a3a3] px-4 py-3 text-xs max-h-72 overflow-auto whitespace-pre-wrap m-0">
        {entries.join("\n")}
      </pre>
    </details>
  );
}
