"use client";

import { useEffect, useRef, useState } from "react";
import { DQ_REASONS, DQ_REASON_LABELS, LOST_REASONS, LOST_REASON_LABELS, STAGE_LABELS, STAGE_STYLE, type LeadStageValue } from "@/lib/lead-status";
import LeadLink from "@/components/LeadLink";

type Row = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  stage: LeadStageValue;
  handoverType: LeadStageValue | null; // which handover (live / attempted / text)
  handoverAt: string | null;
  sheetStatus: string | null; // HIVE STATUS text — the label when no handover is on record
  awaiting: boolean; // handed over, no update yet (else booked / attended / quoted and reminded)
  staleInStage: boolean; // 2× the client's usual time in this stage
  waitingSince: string; // the reminders' clock for the lead's current step
  value: number | null;
  remindedAt: string | null; // a 7-day reminder is out — this is a task
};

// Quick outcomes a client can report. Quoted / Won need the amount; Lost /
// Disqualified need a reason.
const ACTIONS: { key: string; label: string; stage: LeadStageValue; needs?: "value" | "lost" | "dq" }[] = [
  { key: "booked", label: "Consult booked", stage: "CONSULT_BOOKED" },
  { key: "cancelled", label: "Consult cancelled", stage: "CONSULT_CANCELLED" },
  { key: "attended", label: "Attended", stage: "CONSULT_ATTENDED" },
  { key: "quoted", label: "Quoted", stage: "QUOTE_SENT", needs: "value" },
  { key: "won", label: "Won", stage: "WON", needs: "value" },
  { key: "lost", label: "Lost", stage: "LOST", needs: "lost" },
  { key: "dq", label: "Disqualified", stage: "DISQUALIFIED", needs: "dq" },
];

const sydDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" });
const daysAgo = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
// One column template for the header and every row, so they line up:
// lead · status · waiting · what happened.
const GRID = "grid-cols-[minmax(150px,1.1fr)_minmax(130px,170px)_110px_minmax(220px,1.4fr)]";

// Short pill labels (the full ones are long, e.g. "Live attempted (details sent)").
const SHORT_LABELS: Partial<Record<LeadStageValue, string>> = {
  HANDOVER_LIVE: "Live transfer",
  HANDOVER_ATTEMPTED: "Live attempted",
  HANDOVER_TEXT: "Text handover",
};

// Days waiting: 0–6 grey, 7–13 amber (reminded), 14+ red.
const waitStyle = (d: number) =>
  d >= 14 ? { background: "var(--danger-tint)", color: "var(--danger)" } : d >= 7 ? { background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" } : { background: "var(--surface-hover)", color: "var(--text-secondary)" };

// "Update your leads": every handed-over lead waiting on the client's news,
// oldest handover first.
// Saving goes through the normal stage change (logged, written back to the
// sheet), and the row drops off once it's no longer waiting.
export default function ClientUpdatesPanel({
  clientId,
  onUpdateStage,
  reloadKey = 0,
  onSaved,
  pinnedIds = [],
  keepSaved = false,
  emptyText,
}: {
  clientId: string;
  onUpdateStage: (leadId: string, target: string, value?: number) => Promise<void>;
  reloadKey?: number;
  onSaved?: () => void;
  // The email landing page (/clients/<slug>/updates): the email's leads
  // first, highlighted; saved rows stay, green, instead of dropping off.
  pinnedIds?: string[];
  keepSaved?: boolean;
  emptyText?: string; // shown instead of hiding the panel when nothing's waiting
}) {
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [reminders, setReminders] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    fetch(`/api/leads/updates?clientId=${clientId}`)
      .then((r) => r.json())
      .then((d) => {
        if (id !== req.current) return;
        if (d.error) throw new Error(d.error);
        setRows(d.leads);
        setTotal(d.total);
        setReminders(d.reminders ?? 0);
      })
      .catch((e) => id === req.current && setError(e.message));
  }, [clientId, reloadKey, tick]);

  if (!rows) return null;
  if (!rows.length) {
    if (!emptyText) return null; // nothing waiting — no panel
    return <div className="card rounded-2xl p-5 text-sm" style={{ color: "var(--text-secondary)" }}>{emptyText}</div>;
  }
  const pinned = new Set(pinnedIds);
  const ordered = [...rows.filter((r) => pinned.has(r.id)), ...rows.filter((r) => !pinned.has(r.id))];

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--primary)" }}>task_alt</span>
          Update your leads
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: "var(--primary-tint)", color: "var(--primary)" }}>{total}</span>
        </p>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>Tell us what happened with each lead — oldest first. It updates your sheet too.</p>
      {reminders > 0 && (
        <p className="text-xs mb-3 px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }}>
          <span className="material-symbols-outlined text-[14px]">notifications_active</span>
          {reminders} lead{reminders === 1 ? " has" : "s have"} been waiting 7+ days — mark each as won (with the job value) or lost.
        </p>
      )}
      {error && <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>{error}</p>}
      <div className={`grid ${GRID} gap-4 pb-1.5 text-[10px] font-bold tracking-wide`} style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
        <span>LEAD</span>
        <span>STATUS</span>
        <span>WAITING</span>
        <span className="text-right">WHAT HAPPENED?</span>
      </div>
      <div>
        {ordered.map((r) => (
          <UpdateRow
            key={r.id}
            row={r}
            pinned={pinned.has(r.id)}
            saved={saved.has(r.id)}
            onSave={(target, value) =>
              onUpdateStage(r.id, target, value)
                .then(() => {
                  if (keepSaved) setSaved((prev) => new Set(prev).add(r.id));
                  else {
                    setRows((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
                    setTotal((t) => Math.max(0, t - 1));
                    setTick((t) => t + 1);
                  }
                  onSaved?.();
                })
                .catch((e) => setError(e instanceof Error ? e.message : "Couldn't save"))
            }
          />
        ))}
      </div>
      {total > rows.length && <p className="text-[11px] mt-3" style={{ color: "var(--text-muted)" }}>Showing the oldest {rows.length} of {total}.</p>}
    </div>
  );
}

function UpdateRow({ row, onSave, pinned = false, saved = false }: { row: Row; onSave: (target: string, value?: number) => Promise<void>; pinned?: boolean; saved?: boolean }) {
  const [action, setAction] = useState("");
  const [value, setValue] = useState(row.value != null ? String(row.value) : "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const a = ACTIONS.find((x) => x.key === action);
  const amount = Number(value);
  const valid = !!a && (a.needs === "value" ? value.trim() !== "" && Number.isFinite(amount) && amount > 0 : a.needs ? !!reason : true);
  const days = daysAgo(row.waitingSince);
  // The status pill: which handover (or the stage it's sat at); with no
  // handover on record, what the sheet says.
  const statusStage = row.awaiting ? row.handoverType : row.stage;
  const statusLabel = statusStage ? SHORT_LABELS[statusStage] ?? STAGE_LABELS[statusStage] : row.sheetStatus ?? "Awaiting update";
  const statusStyle = statusStage ? STAGE_STYLE[statusStage] : { color: "var(--text-secondary)", bg: "var(--surface-hover)" };
  const statusDate = row.awaiting ? row.handoverAt : row.waitingSince;
  const inputStyle = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };

  function save() {
    if (!a || !valid) return;
    setSaving(true);
    const target = a.needs === "lost" || a.needs === "dq" ? `${a.stage}:${reason}` : a.stage;
    onSave(target, a.needs === "value" ? amount : undefined).finally(() => setSaving(false));
  }

  return (
    <div
      className={`grid ${GRID} items-center gap-4 py-2.5 ${pinned || saved ? "px-3 rounded-lg" : ""}`}
      style={{
        borderBottom: "1px solid var(--border)",
        ...(saved ? { background: "var(--tag-green-bg)" } : pinned ? { background: "var(--primary-tint)", borderLeft: "3px solid var(--primary)" } : {}),
      }}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium flex items-center gap-2 truncate" style={{ color: "var(--text-primary)" }}>
          <LeadLink id={row.id} className="truncate hover:underline">{row.name || "Unnamed lead"}</LeadLink>
          {pinned && !saved && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold shrink-0" style={{ background: "var(--primary)", color: "#fff" }}>From this email</span>}
        </p>
        <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{[row.phone, row.email].filter(Boolean).join(" · ") || "No contact details"}</p>
      </div>

      <div className="min-w-0">
        <span className="inline-block max-w-full truncate px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: statusStyle.bg, color: statusStyle.color }} title={statusLabel}>
          {statusLabel}
        </span>
        {statusDate && <p className="text-[11px] mt-0.5 pl-1" style={{ color: "var(--text-muted)" }}>since {sydDate(statusDate)}</p>}
      </div>

      {saved ? (
        <span className="col-span-2 justify-self-end px-2 py-1 rounded-full text-[11px] font-bold flex items-center gap-1" style={{ color: "var(--tag-green-fg)" }}>
          <span className="material-symbols-outlined text-[14px]">check_circle</span> Saved
        </span>
      ) : (<>
      <div className="flex items-center gap-1.5">
        <span className="px-2 py-1 rounded-full text-[11px] font-bold whitespace-nowrap" style={waitStyle(row.staleInStage ? Math.max(days, 14) : days)}>
          {days}d waiting
        </span>
        {row.remindedAt && (
          <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--tag-amber-fg)" }} title={`Reminder sent ${sydDate(row.remindedAt)}`}>
            notifications_active
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap justify-end">
      {row.staleInStage && action !== "lost" && (
        <button onClick={() => { setAction("lost"); setReason(""); }} className="text-[11px] font-bold underline" style={{ color: "var(--danger)" }}>
          Likely lost? Close it out
        </button>
      )}
      <select value={action} onChange={(e) => { setAction(e.target.value); setReason(""); }} className="px-2 py-1.5 rounded-lg text-xs font-bold outline-none" style={inputStyle} aria-label="What happened">
        <option value="">What happened?</option>
        {ACTIONS.filter((x) => x.stage !== row.stage).map((x) => (
          <option key={x.key} value={x.key}>{x.label}</option>
        ))}
      </select>
      {a?.needs === "value" && (
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={a.stage === "WON" ? "Job value $" : "Quote value $"}
          className="w-28 px-2 py-1.5 rounded-lg text-xs outline-none"
          style={inputStyle}
          aria-label={a.stage === "WON" ? "Job value" : "Quote value"}
        />
      )}
      {(a?.needs === "lost" || a?.needs === "dq") && (
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="px-2 py-1.5 rounded-lg text-xs outline-none" style={inputStyle} aria-label="Reason">
          <option value="">Reason…</option>
          {(a.needs === "lost" ? LOST_REASONS : DQ_REASONS)
            .filter((r) => r !== "UNKNOWN")
            .map((r) => (
              <option key={r} value={r}>{a.needs === "lost" ? LOST_REASON_LABELS[r as keyof typeof LOST_REASON_LABELS] : DQ_REASON_LABELS[r as keyof typeof DQ_REASON_LABELS]}</option>
            ))}
        </select>
      )}
      {a && (
        <button onClick={save} disabled={!valid || saving} className="btn-gradient px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
      )}
      </div>
      </>)}
    </div>
  );
}
