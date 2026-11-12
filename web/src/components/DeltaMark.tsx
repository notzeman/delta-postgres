import React from "react";

/**
 * Brand mark: a delta built from three Borg-style chunks.
 * The apex chunk is the "delta", the only block that changed and got stored.
 */
export default function DeltaMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="11" y="4" width="10" height="10" rx="2" className="fill-delta-400" />
      <rect x="4" y="18" width="10" height="10" rx="2" className="fill-accent-400" />
      <rect x="18" y="18" width="10" height="10" rx="2" className="fill-accent-400/45" />
    </svg>
  );
}
