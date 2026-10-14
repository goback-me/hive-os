"use client";

import { useEffect, useState } from "react";
import type { DuplicateRow, RowCells } from "@/lib/reconcile";

type State = { ok: boolean; duplicates: DuplicateRow[] | null; sheetUrl: string; canDelete: boolean };

const MATCH: Record<DuplicateRow["match"], string> = { email: "same email", phone: "same phone", name: "same name" };

// The "Sheet and HQ don't match" alert's Fix: each pair of sheet rows that
// share an identity (HQ keeps one lead and shows one of them), with Open in
// sheet / Delete row per row, and Sync & re-check
// (app/api/alerts/[id]/duplicates).
export default function DuplicateRowsFix({ alertId }: { alertId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // what's running: "sync" or "row:N"
  const [error, setError] = useState<string | null>(null);

  const apply = (d: State & { error?: string }) => {
    if (d.error) throw new Error(d.error);
    setState(d);
  };

  useEffect(() => {
    fetch(`/api/alerts/${alertId}/duplicates`).then((r) => r.json()).then(apply).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertId]);

  function post(body: object, label: string) {
    setBusy(label);
    setError(null);
    fetch(`/api/alerts/${alertId}/duplicates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then(apply)
      .catch((e) => setError(e.message))
      .finally(() => setBusy(null));
  }

  function remove(row: number, c: RowCells) {
    if (!confirm(`Delete row ${row} (${c.name || c.email || c.phone}) from the Google Sheet?\n\nThe whole row goes. To undo, use File → Version history in Sheets.`)) return;
    post({ row, name: c.name, email: c.email, phone: c.phone }, `row:${row}`);
  }

  const btn = "px-2 py-0.5 rounded-md text-[11px] font-bold disabled:opacity-40";
  const line = (row: number, c: RowCells, inHq: boolean) => (
    <div className="flex items-center gap-2 flex-wrap py-1">
      <span className="text-[11px] font-bold w-14 shrink-0" style={{ color: "var(--text-primary)" }}>Row {row}</span>
      <span className="text-[11px] min-w-0 flex-1" style={{ color: "var(--text-secondary)" }}>
        {[c.name, c.email, c.phone].filter(Boolean).join(" · ")}
        <span style={{ color: "var(--text-muted)" }}> — {c.hive || "no HIVE STATUS"} / {c.prospect || "no Prospect Status"}</span>
      </span>
      <span className="text-[10px] px-1.5 rounded" style={inHq ? { background: "var(--primary-tint)", color: "var(--primary)" } : { background: "var(--surface-hover)", color: "var(--text-muted)" }}>
        {inHq ? "HQ shows this" : "not in HQ"}
      </span>
      <a href={`${state!.sheetUrl}${state!.sheetUrl.includes("#") ? "&" : "#"}range=A${row}`} target="_blank" rel="noreferrer" className={btn} style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}>
        Open in sheet
      </a>
      {state!.canDelete && (
        <button onClick={() => remove(row, c)} disabled={!!busy} className={btn} style={{ border: "1px solid var(--danger)", color: "var(--danger)" }}>
          {busy === `row:${row}` ? "Deleting…" : "Delete row"}
        </button>
      )}
    </div>
  );

  return (
    <div className="mt-2 rounded-lg p-2.5" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
      {!state && !error && <p className="text-xs" style={{ color: "var(--text-muted)" }}>Loading…</p>}
      {state && state.ok && <p className="text-xs font-semibold" style={{ color: "var(--tag-green-fg)" }}>Sheet and HQ match now — this alert clears.</p>}
      {state && !state.ok && (
        <>
          {!state.duplicates ? (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Sync once to list the rows that clash.</p>
          ) : state.duplicates.length > 0 ? (
            <>
              <p className="text-xs mb-1.5" style={{ color: "var(--text-secondary)" }}>
                {state.duplicates.length === 1 ? "This row shares" : `These ${state.duplicates.length} rows share`} an email/phone/name with another row, so HQ counts the pair as one lead.
                Same person twice → delete the extra row. Two different people → open the row and fix its email/phone. Both rows fine as they are → Mark handled.
              </p>
              {state.duplicates.map((d) => (
                <div key={d.row} className="py-1" style={{ borderTop: "1px solid var(--border)" }}>
                  <p className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>Rows {d.keptRow} &amp; {d.row} — {MATCH[d.match]}</p>
                  {line(d.keptRow, d.kept, true)}
                  {line(d.row, d, false)}
                </div>
              ))}
              {!state.canDelete && <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>Deleting rows from here needs Google reconnected with write access (Leads page) — open the rows in the sheet instead.</p>}
            </>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              No duplicate rows — a status was likely renamed or edited mid-sync. <a href={state.sheetUrl} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>Open the sheet</a>, check the values listed above, then sync.
            </p>
          )}
          <button onClick={() => post({ sync: true }, "sync")} disabled={!!busy} className="mt-2 px-2.5 py-1 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: "var(--primary)", color: "#fff" }}>
            {busy === "sync" ? "Syncing…" : "Sync & re-check"}
          </button>
        </>
      )}
      {error && <p className="text-[11px] mt-1" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
