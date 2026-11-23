"use client";

import { useEffect, useState } from "react";
import LeadLink from "@/components/LeadLink";
import { FixCell } from "@/components/FixCell";
import { retryWriteBack, updateLeadStage } from "@/lib/actions";
import { STAGE_LABELS, type LeadStageValue } from "@/lib/lead-status";

// A lead alert's Fix panel, opened in place: every affected lead with the one
// thing to do for it — a value or reason right here, a retry, or a link to
// its row in the sheet. A fixed lead drops off; the alert clears on the next
// check (after the next sync, or Re-check).
export const LEAD_FIX_TYPES = ["WON_NO_VALUE", "QUOTE_NO_VALUE", "DQ_NO_REASON", "LOST_NO_REASON", "WRITEBACK_FAILED", "LEAD_NO_CAMPAIGN", "BAD_OPTIN_DATE", "CLIENT_UPDATE_OVERDUE"];

type Lead = { id: string; name: string; stage: LeadStageValue; sheetWriteError: string | null; sheetRow: number | null; sheetTab: string | null; rowUrl: string | null; handoverAt: string | null };

const STEP: Record<string, string> = {
  WON_NO_VALUE: "Type each job's value and press Save.",
  QUOTE_NO_VALUE: "Type each quote's value and press Save.",
  DQ_NO_REASON: "Pick why each lead was disqualified.",
  LOST_NO_REASON: "Pick why each lead was lost.",
  WRITEBACK_FAILED: "Press Retry on each lead. If it fails again, the reason shows underneath.",
  LEAD_NO_CAMPAIGN: "Open each row in the sheet and fill in its Campaign. HQ picks it up on the next sync.",
  BAD_OPTIN_DATE: "Open each row in the sheet and type the opt-in date as dd/mm/yyyy. HQ picks it up on the next sync.",
  CLIENT_UPDATE_OVERDUE: "Ask the client to update these, or open a lead and set what happened yourself.",
};

const btn = "px-2 py-1 rounded-lg text-xs font-bold disabled:opacity-40";

export default function AlertLeadsFix({ alertId }: { alertId: string }) {
  const [data, setData] = useState<{ type: string; leads: Lead[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    fetch(`/api/alerts/${alertId}/leads`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("Couldn't load the leads"));
  }, [alertId]);

  function run(leadId: string, action: () => Promise<unknown>) {
    setBusy(leadId);
    setError(null);
    action()
      .then(() => setDone((d) => [...d, leadId]))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't save"))
      .finally(() => setBusy(null));
  }

  if (error && !data) return <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{error}</p>;
  if (!data) return <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>Loading leads…</p>;

  const left = data.leads.filter((l) => !done.includes(l.id));
  return (
    <div className="mt-2 rounded-xl p-3 space-y-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{STEP[data.type]}</p>
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
      {left.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          All done. This alert clears on the next check (after the next sync, or press Re-check).
        </p>
      ) : (
        left.map((l) => (
          <div key={l.id} className="flex items-start justify-between gap-3 py-1.5 flex-wrap" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="min-w-0">
              <LeadLink id={l.id} className="text-sm font-medium" style={{ color: "var(--primary)" }}>{l.name}</LeadLink>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {STAGE_LABELS[l.stage]}
                {l.sheetRow ? ` · row ${l.sheetRow}${l.sheetTab ? ` (${l.sheetTab})` : ""}` : ""}
              </p>
              {data.type === "WRITEBACK_FAILED" && l.sheetWriteError && (
                <p className="text-[11px] break-words" style={{ color: "var(--danger)" }}>{l.sheetWriteError.slice(0, 200)}</p>
              )}
            </div>
            <div className="shrink-0">
              {["WON_NO_VALUE", "QUOTE_NO_VALUE", "DQ_NO_REASON", "LOST_NO_REASON"].includes(data.type) && (
                <FixCell lead={l} onFix={(target, value) => run(l.id, () => updateLeadStage(l.id, target, value))} />
              )}
              {data.type === "WRITEBACK_FAILED" && (
                <button disabled={busy === l.id} onClick={() => run(l.id, () => retryWriteBack(l.id))} className={btn} style={{ background: "var(--primary)", color: "#fff" }}>
                  {busy === l.id ? "Retrying…" : "Retry"}
                </button>
              )}
              {l.rowUrl && (
                <a href={l.rowUrl} target="_blank" rel="noreferrer" className={btn} style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                  Open in sheet
                </a>
              )}
              {data.type === "CLIENT_UPDATE_OVERDUE" && (
                <LeadLink id={l.id} className={btn} style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                  Update
                </LeadLink>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
