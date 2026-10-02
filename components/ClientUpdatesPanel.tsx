"use client";

import { useEffect, useRef, useState } from "react";
import { DQ_REASONS, DQ_REASON_LABELS, LOST_REASONS, LOST_REASON_LABELS, STAGE_LABELS, STAGE_STYLE, type LeadStageValue } from "@/lib/lead-status";

type Row = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  campaign: string | null;
  stage: LeadStageValue;
  value: number | null;
  awaitingClientUpdate: boolean;
  createdAt: string;
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

// "Update your leads": the client's to-do list of leads waiting on their news.
// Saving goes through the normal stage change (logged, written back to the
// sheet), and the row drops off once it's no longer waiting.
export default function ClientUpdatesPanel({
  clientId,
  onUpdateStage,
  reloadKey = 0,
  onSaved,
}: {
  clientId: string;
  onUpdateStage: (leadId: string, target: string, value?: number) => Promise<void>;
  reloadKey?: number;
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
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
      })
      .catch((e) => id === req.current && setError(e.message));
  }, [clientId, reloadKey, tick]);

  if (!rows) return null;
  if (!rows.length) return null; // nothing waiting — no panel

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
      {error && <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>{error}</p>}
      <div className="space-y-2">
        {rows.map((r) => (
          <UpdateRow
            key={r.id}
            row={r}
            onSave={(target, value) =>
              onUpdateStage(r.id, target, value)
                .then(() => {
                  setRows((prev) => prev?.filter((x) => x.id !== r.id) ?? null);
                  setTotal((t) => Math.max(0, t - 1));
                  setTick((t) => t + 1);
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

function UpdateRow({ row, onSave }: { row: Row; onSave: (target: string, value?: number) => Promise<void> }) {
  const [action, setAction] = useState("");
  const [value, setValue] = useState(row.value != null ? String(row.value) : "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const a = ACTIONS.find((x) => x.key === action);
  const amount = Number(value);
  const valid = !!a && (a.needs === "value" ? value.trim() !== "" && Number.isFinite(amount) && amount > 0 : a.needs ? !!reason : true);
  const st = STAGE_STYLE[row.stage];
  const inputStyle = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };

  function save() {
    if (!a || !valid) return;
    setSaving(true);
    const target = a.needs === "lost" || a.needs === "dq" ? `${a.stage}:${reason}` : a.stage;
    onSave(target, a.needs === "value" ? amount : undefined).finally(() => setSaving(false));
  }

  return (
    <div className="flex items-center gap-3 flex-wrap py-2" style={{ borderBottom: "1px solid var(--border)" }}>
      <div className="min-w-[180px] flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{row.name || row.phone || row.email || "Unnamed lead"}</p>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {[row.phone, `in ${sydDate(row.createdAt)} (${daysAgo(row.createdAt)}d ago)`].filter(Boolean).join(" · ")}
        </p>
      </div>
      <span className="px-2 py-1 rounded-full text-[10px] font-bold whitespace-nowrap" style={{ background: st.bg, color: st.color }}>
        {row.awaitingClientUpdate ? "Awaiting your update" : STAGE_LABELS[row.stage]}
      </span>
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
  );
}
