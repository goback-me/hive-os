"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MeetingInput } from "@/lib/actions";

type LeadOption = { id: string; label: string; stage: string; returnable: boolean };

const MOODS: { value: MeetingInput["clientMood"]; label: string }[] = [
  { value: "GOOD", label: "Good" },
  { value: "NEUTRAL", label: "Neutral" },
  { value: "AT_RISK", label: "At risk" },
];
const NOT_HELD: { value: MeetingInput["notHeldReason"]; label: string }[] = [
  { value: "NO_SHOW", label: "Client no-show" },
  { value: "RESCHEDULED", label: "Rescheduled" },
  { value: "OTHER", label: "Other" },
];

// The account manager's call log (app/(app)/clients/[slug]/calls/[id]):
// "Call happened" with the client-facing summary + next steps, team-only
// internal notes, outcome, next call, leads and duration — or "Didn't happen"
// with a reason. Saved by submitWeeklyMeeting (lib/actions.ts).
export default function MeetingForm({
  meetingId,
  clientSlug,
  leads,
  onSubmit,
}: {
  meetingId: string;
  clientSlug: string;
  leads: LeadOption[];
  onSubmit: (meetingId: string, input: MeetingInput) => Promise<void>;
}) {
  const router = useRouter();
  const [f, setF] = useState<MeetingInput>({
    held: true,
    summary: "",
    internalNotes: "",
    nextSteps: "",
    clientMood: "",
    nextMeetingAt: "",
    leadsDiscussed: [],
    leadsReturned: [],
    durationMins: "",
    skipEmail: false,
    notHeldReason: "",
    notHeldText: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const set = <K extends keyof MeetingInput>(k: K, v: MeetingInput[K]) => setF((p) => ({ ...p, [k]: v }));

  const submit = () =>
    startTransition(async () => {
      setError(null);
      try {
        await onSubmit(meetingId, f);
        router.push(`/clients/${clientSlug}?tab=weekly`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });

  const toggle = (on: boolean) => (
    <button
      onClick={() => set("held", on)}
      className="px-4 py-2 rounded-lg text-sm font-bold"
      style={f.held === on ? { background: "var(--primary)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}
    >
      {on ? "Call happened" : "Didn't happen"}
    </button>
  );

  return (
    <div className="card rounded-2xl p-5 space-y-4">
      <div className="flex gap-2">
        {toggle(true)}
        {toggle(false)}
      </div>

      {f.held ? (
        <>
          <Area label="Summary — the client sees this" value={f.summary} onChange={(v) => set("summary", v)} style={input} rows={3} />
          <Area label="Next steps — one per line, the client sees these" value={f.nextSteps} onChange={(v) => set("nextSteps", v)} style={input} rows={3} />
          <div className="rounded-xl p-3" style={{ background: "var(--tag-amber-bg)" }}>
            <Area label="Internal — not visible to client" value={f.internalNotes} onChange={(v) => set("internalNotes", v)} style={input} />
          </div>
          <div className="flex gap-4 flex-wrap">
            <label className="block">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Outcome (team only)</span>
              <div className="flex gap-1.5 mt-1">
                {MOODS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => set("clientMood", f.clientMood === m.value ? "" : m.value)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={f.clientMood === m.value ? { background: m.value === "AT_RISK" ? "var(--danger)" : "var(--primary)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Next call</span>
              <input type="date" value={f.nextMeetingAt} onChange={(e) => set("nextMeetingAt", e.target.value)} className="block mt-1 px-2 py-1.5 rounded-lg text-sm outline-none" style={input} />
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Duration (mins)</span>
              <input type="number" min={1} max={600} value={f.durationMins} onChange={(e) => set("durationMins", e.target.value)} className="block mt-1 w-24 px-2 py-1.5 rounded-lg text-sm outline-none" style={input} />
            </label>
          </div>
          <LeadPicker label="Leads discussed" leads={leads} value={f.leadsDiscussed} onChange={(v) => set("leadsDiscussed", v)} style={input} />
          <LeadPicker
            label="Return to chase up (the client is handing them back)"
            leads={leads.filter((l) => l.returnable)}
            value={f.leadsReturned}
            onChange={(v) => set("leadsReturned", v)}
            style={input}
          />
        </>
      ) : (
        <>
          <div className="flex gap-1.5">
            {NOT_HELD.map((r) => (
              <button
                key={r.value}
                onClick={() => set("notHeldReason", r.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold"
                style={f.notHeldReason === r.value ? { background: "var(--primary)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Area label="Details (optional)" value={f.notHeldText} onChange={(v) => set("notHeldText", v)} style={input} />
        </>
      )}

      {f.held && (
        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={f.skipEmail} onChange={(e) => set("skipEmail", e.target.checked)} />
          Don&apos;t email client this time
        </label>
      )}

      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={pending} className="btn-gradient px-5 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
          {pending ? "Saving…" : "Save call log"}
        </button>
        {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
    </div>
  );
}

function Area({ label, value, onChange, style, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; style: React.CSSProperties; rows?: number }) {
  return (
    <label className="block">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} className="w-full mt-1 px-2 py-1.5 rounded-lg text-sm outline-none resize-none" style={style} />
    </label>
  );
}

// Search the client's leads; picked ones show as removable chips.
function LeadPicker({ label, leads, value, onChange, style }: { label: string; leads: LeadOption[]; value: string[]; onChange: (v: string[]) => void; style: React.CSSProperties }) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const matches = q.trim() ? leads.filter((l) => !value.includes(l.id) && l.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  return (
    <div>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {value.map((id) => (
          <span key={id} className="px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1" style={{ background: "var(--primary-tint)", color: "var(--primary)" }}>
            {byId.get(id)?.label ?? "Lead"}
            <button onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Remove" className="font-bold">×</button>
          </span>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone…" className="w-full mt-1 px-2 py-1.5 rounded-lg text-sm outline-none" style={style} />
      {matches.length > 0 && (
        <div className="mt-1 rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {matches.map((l) => (
            <button
              key={l.id}
              onClick={() => (onChange([...value, l.id]), setQ(""))}
              className="w-full text-left px-3 py-1.5 text-xs flex justify-between"
              style={{ background: "var(--surface)", color: "var(--text-primary)" }}
            >
              <span>{l.label}</span>
              <span style={{ color: "var(--text-muted)" }}>{l.stage}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
