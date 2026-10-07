"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { STAGE_STYLE, encodeTarget, stageText, type DqPhaseValue, type DqReasonValue, type LeadStageValue, type LostReasonValue } from "@/lib/lead-status";
import { NOTE_EVENT_LABELS, type NoteEventValue } from "@/lib/notes-parser";
import { addLeadNote, updateLeadStage } from "@/lib/actions";
import { setLeadParam } from "@/components/LeadLink";

type Detail = {
  lead: {
    id: string;
    clientName: string;
    clientSlug: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    campaign: string | null;
    source: string | null;
    createdAt: string;
    stage: LeadStageValue;
    dqReason: DqReasonValue | null;
    dqPhase: DqPhaseValue | null;
    lostReason: LostReasonValue | null;
    dqReasonEvidence: string | null;
    callAttempts: number | null;
    value: number | null;
    returnedCount: number;
    sheetStatus: string | null;
    sheetWriteError: string | null;
    raw: Record<string, string> | null;
  };
  timeline: { key: string; label: string; at: string | null; days: number | null }[];
  sheetNotes: { id: string; at: string; who: string; text: string; tag: NoteEventValue }[];
  hqNotes: { id: string; at: string; who: string; text: string }[];
  changes: { id: string; at: string; who: string; to: LeadStageValue; value: number | null }[];
  stageOptions: { value: string; label: string }[];
};

// Lead changed in the drawer — open lists (components/LeadsPanel.tsx) reload.
export const LEAD_CHANGED_EVENT = "hq:lead-changed";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" });
const money = (v: number) => `$${v.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
const NEEDS_VALUE = ["WON", "QUOTE_SENT"];

// Mounted once in the app layout: shows the drawer for ?lead=<id> (see LeadLink).
export function LeadDrawerHost() {
  const id = useSearchParams().get("lead");
  return id ? <LeadDetailDrawer key={id} leadId={id} onClose={() => setLeadParam(null)} /> : null;
}

// The right-side lead panel, opened from any lead anywhere in HQ: contact,
// stage (+ quick edit), milestones with the days between, call attempts,
// value, returns, and every note (the sheet's + HQ's).
export default function LeadDetailDrawer({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    fetch(`/api/leads/detail?leadId=${encodeURIComponent(leadId)}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error);
        setD(res);
        setTarget(encodeTarget({ stage: res.lead.stage, dqReason: res.lead.dqReason ?? undefined, lostReason: res.lead.lostReason ?? undefined }));
        setValue(res.lead.value != null ? String(res.lead.value) : "");
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      router.refresh();
      window.dispatchEvent(new Event(LEAD_CHANGED_EVENT));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const l = d?.lead;
  const current = l ? encodeTarget({ stage: l.stage, dqReason: l.dqReason ?? undefined, lostReason: l.lostReason ?? undefined }) : "";
  const needsValue = NEEDS_VALUE.includes(target.split(":")[0]);
  const notes = d
    ? [
        ...d.sheetNotes.map((n) => ({ id: n.id, at: n.at, who: n.who, text: n.text, tag: NOTE_EVENT_LABELS[n.tag], kind: "sheet" as const })),
        ...d.hqNotes.map((n) => ({ id: n.id, at: n.at, who: n.who, text: n.text, tag: "HQ note", kind: "hq" as const })),
        ...d.changes.map((c) => ({ id: c.id, at: c.at, who: c.who, text: `Moved to ${stageText({ stage: c.to })}${c.value != null ? ` · ${money(c.value)}` : ""}`, tag: "Stage", kind: "change" as const })),
      ].sort((a, b) => b.at.localeCompare(a.at))
    : [];
  const input = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const label = "text-[10px] font-bold tracking-wide mb-2";

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Lead details">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[460px] overflow-y-auto shadow-2xl" style={{ background: "var(--surface-card)", borderLeft: "1px solid var(--border)" }}>
        <div className="p-6 space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-heading font-bold text-xl truncate" style={{ color: "var(--text-primary)" }}>{l ? l.name || "Unnamed lead" : "Loading…"}</h2>
              {l && (
                <p className="text-sm mt-0.5 space-x-2" style={{ color: "var(--text-secondary)" }}>
                  {l.phone && <a href={`tel:${l.phone}`} className="hover:underline">{l.phone}</a>}
                  {l.email && <a href={`mailto:${l.email}`} className="hover:underline">{l.email}</a>}
                  {!l.phone && !l.email && <span>No contact info</span>}
                </p>
              )}
              {l && <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{l.clientName}</p>}
            </div>
            <button onClick={onClose} className="material-symbols-outlined shrink-0" style={{ color: "var(--text-muted)" }} aria-label="Close">close</button>
          </div>
          {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}

          {l && d && (
            <>
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: STAGE_STYLE[l.stage].bg, color: STAGE_STYLE[l.stage].color }}>{stageText(l)}</span>
                  {l.sheetWriteError && <span className="text-xs" style={{ color: "var(--danger)" }} title={l.sheetWriteError}>Not synced to sheet</span>}
                </div>
                {l.dqReasonEvidence && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Reason: “{l.dqReasonEvidence}”</p>}
                {d.stageOptions.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={target} onChange={(e) => setTarget(e.target.value)} className="px-2 py-1.5 rounded-lg text-xs outline-none" style={input} aria-label="Change stage">
                      {!d.stageOptions.some((o) => o.value === current) && <option value={current}>{stageText(l)}</option>}
                      {d.stageOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {needsValue && <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value $" className="w-24 px-2 py-1.5 rounded-lg text-xs outline-none" style={input} aria-label="Value" />}
                    {(target !== current || (needsValue && value !== (l.value != null ? String(l.value) : ""))) && (
                      <button
                        disabled={busy}
                        onClick={() => run(() => updateLeadStage(l.id, target, needsValue && value.trim() ? Number(value) : undefined))}
                        className="btn-gradient px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                {(
                  [
                    ["Campaign", l.campaign?.trim() && l.campaign.trim() !== "-" ? l.campaign : "Unattributed"],
                    ["Opted in", day(l.createdAt)],
                    ["Call attempts", l.callAttempts != null ? String(l.callAttempts) : "—"],
                    [l.stage === "WON" ? "Job value" : "Quote value", l.value != null ? money(l.value) : "—"],
                    ["Returned by client", l.returnedCount ? `${l.returnedCount}×` : "Never"],
                    ["Sheet status", l.sheetStatus || "—"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px]" style={{ color: "var(--text-muted)" }}>{k}</dt>
                    <dd className="font-medium break-words" style={{ color: "var(--text-primary)" }}>{v}</dd>
                  </div>
                ))}
              </dl>

              <div>
                <p className={label} style={{ color: "var(--text-secondary)" }}>MILESTONES</p>
                <ol className="space-y-2">
                  {d.timeline.map((s) => (
                    <li key={s.key} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2" style={{ color: s.at ? "var(--text-primary)" : "var(--text-muted)" }}>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.at ? "var(--primary)" : "var(--border)" }} />
                        {s.label}
                      </span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {s.at ? day(s.at) : "—"}
                        {s.days != null && <span className="ml-2 font-semibold">+{s.days}d</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <p className={label} style={{ color: "var(--text-secondary)" }}>NOTES</p>
                <div className="flex gap-2 mb-3">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={input} aria-label="New note" />
                  <button
                    disabled={busy || !note.trim()}
                    onClick={() =>
                      run(async () => {
                        const f = new FormData();
                        f.set("note", note.trim());
                        await addLeadNote(l.id, f);
                        setNote("");
                      })
                    }
                    className="px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
                    style={{ background: "var(--primary)", color: "#fff" }}
                  >
                    Add
                  </button>
                </div>
                {notes.length === 0 && <p className="text-xs" style={{ color: "var(--text-muted)" }}>No notes yet.</p>}
                <div className="space-y-2">
                  {notes.map((n) => (
                    <div key={`${n.kind}-${n.id}`} className="p-2.5 rounded-lg" style={{ background: n.kind === "hq" ? "var(--primary-tint)" : "var(--surface-hover)" }}>
                      <p className="text-xs" style={{ color: "var(--text-primary)" }}>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold mr-1.5" style={{ background: "var(--surface-card)", color: "var(--text-secondary)" }}>{n.tag}</span>
                        {n.text}
                      </p>
                      <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{n.who} · {day(n.at)}{n.kind === "sheet" ? " · from the sheet" : ""}</p>
                    </div>
                  ))}
                </div>
              </div>

              {l.raw && Object.values(l.raw).some(Boolean) && (
                <details>
                  <summary className={`${label} cursor-pointer`} style={{ color: "var(--text-secondary)" }}>SHEET DETAILS</summary>
                  <div className="space-y-2 mt-2">
                    {Object.entries(l.raw).filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} className="p-2.5 rounded-lg" style={{ background: "var(--surface-hover)" }}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>{k}</p>
                        <p className="text-xs whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>{v}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <a href={`/clients/${l.clientSlug}?tab=leads&lead=${l.id}`} className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: "var(--primary)" }}>
                Open full lead <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </a>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
