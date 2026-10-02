"use client";

import { useState } from "react";

export type AlertItem = {
  id: string;
  clientName: string;
  clientSlug: string;
  severity: "DANGER" | "WARNING";
  title: string;
  detail: string;
  fixHint: string;
  fixUrl: string | null;
  status?: string;
  lastSeenAt: string;
  dismissNote?: string | null;
};

// One data alert: what's wrong, how to fix it, a Fix link, and "Mark
// handled" (a note is required). Shared by the bell, the client banner and
// the /alerts page.
export default function AlertRow({ alert, showClient, onHandled }: { alert: AlertItem; showClient?: boolean; onHandled?: (id: string) => void }) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const danger = alert.severity === "DANGER";

  function handle() {
    if (!note.trim()) return;
    setSaving(true);
    setError(null);
    fetch(`/api/alerts/${alert.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        onHandled?.(alert.id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  }

  return (
    <div className="py-2.5 flex items-start gap-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <span
        className="material-symbols-outlined text-[18px] mt-0.5 shrink-0"
        style={{ color: danger ? "var(--danger)" : "var(--tag-amber-fg)" }}
        aria-label={danger ? "Serious" : "Warning"}
      >
        {danger ? "error" : "warning"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {showClient && <span style={{ color: "var(--text-muted)" }}>{alert.clientName} · </span>}
          {alert.title}
        </p>
        {alert.detail && <p className="text-xs mt-0.5 whitespace-pre-line" style={{ color: "var(--text-secondary)" }}>{alert.detail}</p>}
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>Fix: {alert.fixHint}</p>
        {alert.dismissNote && <p className="text-[11px] mt-0.5 italic" style={{ color: "var(--text-muted)" }}>Handled: {alert.dismissNote}</p>}
        {(!alert.status || alert.status === "OPEN") && (
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {alert.fixUrl && (
              <a href={alert.fixUrl} className="px-2.5 py-1 rounded-lg text-xs font-bold" style={{ background: "var(--primary)", color: "#fff" }}>
                Fix
              </a>
            )}
            {noting ? (
              <>
                <input
                  autoFocus
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handle(); }}
                  placeholder="What was done / why it's OK"
                  className="flex-1 min-w-[160px] px-2 py-1 rounded-lg text-xs outline-none"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  aria-label="Note"
                />
                <button onClick={handle} disabled={!note.trim() || saving} className="px-2.5 py-1 rounded-lg text-xs font-bold disabled:opacity-40" style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button onClick={() => setNoting(true)} className="px-2.5 py-1 rounded-lg text-xs font-bold" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                Mark handled
              </button>
            )}
            {error && <span className="text-[11px]" style={{ color: "var(--danger)" }}>{error}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
