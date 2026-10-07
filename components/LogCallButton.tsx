"use client";

import { useState } from "react";
import { openCallPanel } from "@/lib/url-param";

// "Log a call": opens the update panel on the client's call to log — the
// oldest one still waiting, else the next booked one, else a new one now
// (callToLog in lib/actions.ts).
export default function LogCallButton({ clientId, onFind, label = "Log a call" }: { clientId: string; onFind: (clientId: string) => Promise<string>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            openCallPanel(await onFind(clientId));
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't open the call");
          } finally {
            setBusy(false);
          }
        }}
        className="btn-gradient px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[16px]">call</span> {label}
      </button>
      {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
    </span>
  );
}
