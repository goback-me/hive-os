"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { editCallLog, logCallHeld, logCallNotHeld, rescheduleCallTo, type CallLogInput } from "@/lib/actions";
import { openCallPanel, setUrlParams } from "@/lib/url-param";
import LeadLink from "@/components/LeadLink";

type Kpi = { label: string; now: number; before: number; tone: "green" | "amber" | "red" | null };
type LeadOption = { id: string; label: string; stage: string; returnable: boolean };
type Detail = {
  call: {
    id: string;
    scheduledAt: string;
    status: "PENDING" | "HELD" | "RESCHEDULED" | "NOT_HELD";
    summary: string | null;
    nextSteps: string[];
    stepsDone: number[];
    internalNotes: string | null;
    outcome: "GOOD" | "NEUTRAL" | "AT_RISK" | null;
    notHeldReason: string | null;
    rescheduleReason: string | null;
    nextCallAt: string | null;
    durationMins: number | null;
    emailedToClientAt: string | null;
    loggedAt: string | null;
    submittedBy: string | null;
    leadsReturned: string[];
    callPerson: { name: string } | null;
    client: { name: string; slug: string; callTime: string };
  };
  movedTo: { id: string; at: string } | null;
  context: { kpis: Kpi[]; waitingCount: number; waiting: { id: string; name: string; stage: string }[]; lastSteps: { at: string; steps: string[] } | null; alerts: { title: string; severity: "DANGER" | "WARNING" }[] };
  leads: LeadOption[];
};

// After a save, open lists patch themselves straight away (optimistic) and
// then refresh: detail = { id, status, at? (new time), newId? }.
export const CALL_CHANGED_EVENT = "hq:call-changed";
export type CallChange = { id: string; status: Detail["call"]["status"]; at?: string; newId?: string };

const OUTCOMES = [
  { value: "GOOD", label: "Good" },
  { value: "NEUTRAL", label: "Neutral" },
  { value: "AT_RISK", label: "At risk" },
] as const;
const NOT_HELD = [
  { value: "NO_SHOW", label: "Client no-show" },
  { value: "AM_UNAVAILABLE", label: "AM unavailable" },
  { value: "OTHER", label: "Other" },
] as const;
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short" });
const TONE = { red: "var(--danger)", amber: "var(--tag-amber-fg)", green: "var(--tag-green-fg)" };

// Mounted once in the app layout: ?update=<callId> opens the panel anywhere.
export function CallPanelHost() {
  const sp = useSearchParams();
  const id = sp.get("update");
  return id ? <CallUpdatePanel key={id} callId={id} startRescheduling={sp.get("mode") === "reschedule"} onClose={() => setUrlParams({ update: null, mode: null })} /> : null;
}

// The call update panel: ✅ happened / 🔁 rescheduled / ❌ didn't happen,
// with the client's context on top. A logged call shows what was logged
// (held ones can be edited). Never a page change.
export default function CallUpdatePanel({ callId, onClose, startRescheduling }: { callId: string; onClose: () => void; startRescheduling?: boolean }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"held" | "rescheduled" | "not_held" | "edit" | null>(startRescheduling ? "rescheduled" : null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/calls/${encodeURIComponent(callId)}`)
      .then((r) => r.json())
      .then((res) => (res.error ? setError(res.error) : setD(res)))
      .catch((e) => setError(e.message));
  }, [callId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(fn: () => Promise<unknown>, change: (r: unknown) => CallChange) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      window.dispatchEvent(new CustomEvent<CallChange>(CALL_CHANGED_EVENT, { detail: change(r) }));
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
      setBusy(false);
    }
  }

  const c = d?.call;
  const big = "flex-1 px-3 py-4 rounded-xl text-sm font-bold flex flex-col items-center gap-1";

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Update call">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[520px] overflow-y-auto shadow-2xl" style={{ background: "var(--surface-card)", borderLeft: "1px solid var(--border)" }}>
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-heading font-bold text-xl truncate" style={{ color: "var(--text-primary)" }}>{c ? c.client.name : "Loading…"}</h2>
              {c && (
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  Call · {when(c.scheduledAt)}
                  {c.callPerson && ` · ${c.callPerson.name}`}
                </p>
              )}
            </div>
            <button onClick={onClose} className="material-symbols-outlined shrink-0" style={{ color: "var(--text-muted)" }} aria-label="Close">close</button>
          </div>
          {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}

          {d && c && (
            <>
              <Context d={d} />

              {c.status === "PENDING" && !mode && (
                <div className="flex gap-2">
                  <button className={big} style={{ background: "var(--tag-green-bg)", color: "var(--tag-green-fg)" }} onClick={() => setMode("held")}>
                    <span className="text-xl">✅</span>Call happened
                  </button>
                  <button className={big} style={{ background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }} onClick={() => setMode("rescheduled")}>
                    <span className="text-xl">🔁</span>Rescheduled
                  </button>
                  <button className={big} style={{ background: "var(--danger-tint)", color: "var(--danger)" }} onClick={() => setMode("not_held")}>
                    <span className="text-xl">❌</span>Didn&apos;t happen
                  </button>
                </div>
              )}

              {mode === "held" && (
                <HeldForm
                  leads={d.leads}
                  busy={busy}
                  onBack={() => setMode(null)}
                  onSave={(input) => save(() => logCallHeld(c.id, input), () => ({ id: c.id, status: "HELD" }))}
                />
              )}
              {mode === "edit" && (
                <HeldForm
                  edit
                  initial={c}
                  leads={d.leads}
                  busy={busy}
                  onBack={() => setMode(null)}
                  onSave={(input) => save(() => editCallLog(c.id, input), () => ({ id: c.id, status: "HELD" }))}
                />
              )}
              {mode === "rescheduled" && c.status === "PENDING" && (
                <RescheduleForm
                  defaultTime={c.client.callTime}
                  busy={busy}
                  onBack={() => setMode(null)}
                  onSave={(whenStr, reason) => save(() => rescheduleCallTo(c.id, whenStr, reason), (newId) => ({ id: c.id, status: "RESCHEDULED", newId: newId as string, at: whenStr }))}
                />
              )}
              {mode === "not_held" && (
                <NotHeldForm busy={busy} onBack={() => setMode(null)} onSave={(key, text) => save(() => logCallNotHeld(c.id, key, text), () => ({ id: c.id, status: "NOT_HELD" }))} />
              )}

              {c.status !== "PENDING" && mode !== "edit" && <Logged d={d} onEdit={() => setMode("edit")} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Context({ d }: { d: Detail }) {
  const box = "rounded-xl p-3";
  const label = "text-[10px] font-bold tracking-wide mb-1.5";
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className={box} style={{ background: "var(--surface-hover)" }}>
        <p className={label} style={{ color: "var(--text-secondary)" }}>THIS MONTH (vs same days last month)</p>
        {d.context.kpis.map((k) => (
          <p key={k.label} className="flex justify-between" style={{ color: "var(--text-primary)" }}>
            <span>{k.label}</span>
            <span style={{ color: k.tone ? TONE[k.tone] : undefined }}>
              {k.now} <span style={{ color: "var(--text-muted)" }}>/ {k.before}</span>
            </span>
          </p>
        ))}
      </div>
      <div className={box} style={{ background: "var(--surface-hover)" }}>
        <p className={label} style={{ color: "var(--text-secondary)" }}>WAITING ON THE CLIENT ({d.context.waitingCount})</p>
        {d.context.waiting.length ? (
          d.context.waiting.map((l) => (
            <p key={l.id} className="truncate" style={{ color: "var(--text-primary)" }}>
              <LeadLink id={l.id}>{l.name}</LeadLink> <span style={{ color: "var(--text-muted)" }}>· {l.stage}</span>
            </p>
          ))
        ) : (
          <p style={{ color: "var(--text-muted)" }}>Nothing waiting.</p>
        )}
      </div>
      <div className={box} style={{ background: "var(--surface-hover)" }}>
        <p className={label} style={{ color: "var(--text-secondary)" }}>LAST CALL&apos;S NEXT STEPS{d.context.lastSteps ? ` (${day(d.context.lastSteps.at)})` : ""}</p>
        {d.context.lastSteps?.steps.length ? (
          d.context.lastSteps.steps.map((s, i) => <p key={i} style={{ color: "var(--text-primary)" }}>• {s}</p>)
        ) : (
          <p style={{ color: "var(--text-muted)" }}>None.</p>
        )}
      </div>
      <div className={box} style={{ background: "var(--surface-hover)" }}>
        <p className={label} style={{ color: "var(--text-secondary)" }}>OPEN ALERTS ({d.context.alerts.length})</p>
        {d.context.alerts.length ? (
          d.context.alerts.map((a, i) => <p key={i} style={{ color: a.severity === "DANGER" ? "var(--danger)" : "var(--text-primary)" }}>{a.title}</p>)
        ) : (
          <p style={{ color: "var(--text-muted)" }}>None.</p>
        )}
      </div>
    </div>
  );
}

function Logged({ d, onEdit }: { d: Detail; onEdit: () => void }) {
  const c = d.call;
  const head = { HELD: "Call held", RESCHEDULED: "Rescheduled", NOT_HELD: "Didn't happen", PENDING: "" }[c.status];
  return (
    <div className="space-y-3 text-sm" style={{ color: "var(--text-secondary)" }}>
      <div className="flex items-center justify-between">
        <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {head} · logged by {c.submittedBy ?? "—"}
          {c.status === "HELD" && (c.emailedToClientAt ? " · emailed to the client" : " · not emailed")}
        </p>
        {c.status === "HELD" && (
          <button onClick={onEdit} className="text-xs font-bold" style={{ color: "var(--primary)" }}>Edit</button>
        )}
      </div>
      {c.status === "RESCHEDULED" && (
        <p>
          Moved to {d.movedTo ? when(d.movedTo.at) : "—"}
          {c.rescheduleReason ? ` — ${c.rescheduleReason}` : ""}
          {d.movedTo && (
            <button onClick={() => openCallPanel(d.movedTo!.id)} className="ml-2 text-xs font-bold" style={{ color: "var(--primary)" }}>Open the new call</button>
          )}
        </p>
      )}
      {c.status === "NOT_HELD" && <p>{c.notHeldReason}</p>}
      {c.status === "HELD" && (
        <>
          <p className="whitespace-pre-wrap">{c.summary}</p>
          {c.nextSteps.length > 0 && (
            <ul className="list-disc pl-5">
              {c.nextSteps.map((s, i) => (
                <li key={i} style={{ textDecoration: c.stepsDone.includes(i) ? "line-through" : undefined }}>{s}</li>
              ))}
            </ul>
          )}
          <p>{[c.nextCallAt && `Next call ${when(c.nextCallAt)}`, c.durationMins && `${c.durationMins} mins`, c.leadsReturned.length > 0 && `${c.leadsReturned.length} lead(s) returned to chase up`].filter(Boolean).join(" · ")}</p>
          {(c.internalNotes || c.outcome) && (
            <div className="rounded-xl p-3" style={{ background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }}>
              <p className="text-xs font-bold mb-1">Internal — not visible to client</p>
              {c.outcome && <p>Outcome: {OUTCOMES.find((o) => o.value === c.outcome)?.label}</p>}
              {c.internalNotes && <p className="whitespace-pre-wrap">{c.internalNotes}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const inputStyle = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };

function Actions({ busy, onBack, onSave, label, disabled }: { busy: boolean; onBack: () => void; onSave: () => void; label: string; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <button onClick={onSave} disabled={busy || disabled} className="btn-gradient px-5 py-2 rounded-lg text-sm font-bold disabled:opacity-50">{busy ? "Saving…" : label}</button>
      <button onClick={onBack} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Back</button>
    </div>
  );
}

function HeldForm({ leads, busy, onBack, onSave, edit, initial }: { leads: LeadOption[]; busy: boolean; onBack: () => void; onSave: (i: CallLogInput) => void; edit?: boolean; initial?: Detail["call"] }) {
  const [f, setF] = useState<CallLogInput>({
    summary: initial?.summary ?? "",
    nextSteps: initial?.nextSteps.join("\n") ?? "",
    internalNotes: initial?.internalNotes ?? "",
    outcome: initial?.outcome ?? "",
    nextCallAt: "",
    leadsDiscussed: [],
    leadsReturned: [],
    durationMins: initial?.durationMins ? String(initial.durationMins) : "",
    skipEmail: false,
  });
  const set = <K extends keyof CallLogInput>(k: K, v: CallLogInput[K]) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3">
      <Area label="Summary — the client sees this" value={f.summary} onChange={(v) => set("summary", v)} rows={3} />
      <Area label="Next steps — one per line, the client sees these" value={f.nextSteps} onChange={(v) => set("nextSteps", v)} rows={3} />
      <div className="rounded-xl p-3" style={{ background: "var(--tag-amber-bg)" }}>
        <Area label="Internal — not visible to client" value={f.internalNotes} onChange={(v) => set("internalNotes", v)} />
      </div>
      <div>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Outcome (team only)</span>
        <div className="flex gap-1.5 mt-1">
          {OUTCOMES.map((o) => (
            <button
              key={o.value}
              onClick={() => set("outcome", f.outcome === o.value ? "" : o.value)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold"
              style={f.outcome === o.value ? { background: o.value === "AT_RISK" ? "var(--danger)" : "var(--primary)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {!edit && (
        <>
          <LeadPicker label="Leads discussed" leads={leads} value={f.leadsDiscussed} onChange={(v) => set("leadsDiscussed", v)} />
          <LeadPicker label="Return to chase up (the client is handing them back)" leads={leads.filter((l) => l.returnable)} value={f.leadsReturned} onChange={(v) => set("leadsReturned", v)} />
        </>
      )}
      <div className="flex gap-3 flex-wrap">
        {!edit && (
          <label className="block">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Next call (blank = the regular slot)</span>
            <input type="datetime-local" step={900} value={f.nextCallAt} onChange={(e) => set("nextCallAt", e.target.value)} className="block mt-1 px-2 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} />
          </label>
        )}
        <label className="block">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Duration (mins)</span>
          <input type="number" min={1} max={600} value={f.durationMins} onChange={(e) => set("durationMins", e.target.value)} className="block mt-1 w-24 px-2 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} />
        </label>
      </div>
      {!edit && (
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={f.skipEmail} onChange={(e) => set("skipEmail", e.target.checked)} />
          Don&apos;t email client
        </label>
      )}
      <Actions busy={busy} onBack={onBack} onSave={() => onSave(f)} label={edit ? "Save changes" : "Save — call happened"} disabled={!f.summary.trim()} />
    </div>
  );
}

function RescheduleForm({ defaultTime, busy, onBack, onSave }: { defaultTime: string; busy: boolean; onBack: () => void; onSave: (when: string, reason: string) => void }) {
  const [at, setAt] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>New date and time</span>
        <input type="datetime-local" step={900} value={at} onChange={(e) => setAt(e.target.value)} className="block mt-1 px-2 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} required />
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Their regular time is {defaultTime}.</span>
      </label>
      <Area label="Reason" value={reason} onChange={setReason} />
      <Actions busy={busy} onBack={onBack} onSave={() => onSave(at, reason)} label="Reschedule" disabled={!at} />
    </div>
  );
}

function NotHeldForm({ busy, onBack, onSave }: { busy: boolean; onBack: () => void; onSave: (key: string, text: string) => void }) {
  const [key, setKey] = useState("");
  const [text, setText] = useState("");
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {NOT_HELD.map((r) => (
          <button
            key={r.value}
            onClick={() => setKey(r.value)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold"
            style={key === r.value ? { background: "var(--primary)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            {r.label}
          </button>
        ))}
      </div>
      <Area label="Details (optional — the client never sees this)" value={text} onChange={setText} />
      <Actions busy={busy} onBack={onBack} onSave={() => onSave(key, text)} label="Save — didn't happen" disabled={!key} />
    </div>
  );
}

function Area({ label, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className="w-full mt-1 px-2 py-1.5 rounded-lg text-sm outline-none resize-none" style={inputStyle} />
    </label>
  );
}

// Search the client's leads; picked ones show as removable chips (each opens
// its lead drawer).
function LeadPicker({ label, leads, value, onChange }: { label: string; leads: LeadOption[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const matches = q.trim() ? leads.filter((l) => !value.includes(l.id) && l.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  return (
    <div>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {value.map((id) => (
          <span key={id} className="px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1" style={{ background: "var(--primary-tint)", color: "var(--primary)" }}>
            <LeadLink id={id}>{byId.get(id)?.label ?? "Lead"}</LeadLink>
            <button onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Remove" className="font-bold">×</button>
          </span>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone…" className="w-full mt-1 px-2 py-1.5 rounded-lg text-sm outline-none" style={inputStyle} />
      {matches.length > 0 && (
        <div className="mt-1 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {matches.map((l) => (
            <button key={l.id} onClick={() => (onChange([...value, l.id]), setQ(""))} className="w-full text-left px-3 py-1.5 text-xs flex justify-between" style={{ background: "var(--surface)", color: "var(--text-primary)" }}>
              <span>{l.label}</span>
              <span style={{ color: "var(--text-muted)" }}>{l.stage}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
