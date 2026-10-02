"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Update = { id: string; weekOf: string; wins: string; issues: string; nextSteps: string; createdBy: string };
type Draft = { weekOf: string; wins: string; issues: string; nextSteps: string };

const weekLabel = (iso: string) => `Week of ${new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" })}`;

// "This week's update" on the client Dashboard: newest first, earlier weeks
// underneath. Coaches write it, starting from a draft built from the week's
// numbers, open problems and next steps.
export default function WeeklyUpdatesPanel({
  clientId,
  isCoach,
  currentWeekOf,
  initial,
  onDraft,
  onSave,
}: {
  clientId: string;
  isCoach: boolean;
  currentWeekOf: string;
  initial: Update[];
  onDraft?: (clientId: string) => Promise<Draft>;
  onSave?: (clientId: string, input: Draft) => Promise<void>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const thisWeek = initial.find((u) => u.weekOf === currentWeekOf);
  const [latest, ...older] = initial;
  const input = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };

  function startEditing() {
    setError(null);
    if (thisWeek) return setDraft({ weekOf: thisWeek.weekOf, wins: thisWeek.wins, issues: thisWeek.issues, nextSteps: thisWeek.nextSteps });
    startTransition(async () => {
      try {
        setDraft(await onDraft!(clientId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't build a draft");
      }
    });
  }
  function save() {
    if (!draft) return;
    startTransition(async () => {
      try {
        await onSave!(clientId, draft);
        setDraft(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  if (!isCoach && !latest) return null;

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--primary)" }}>campaign</span>
          {latest && latest.weekOf === currentWeekOf ? "This week's update" : "Weekly update"}
        </p>
        {isCoach && !draft && (
          <button onClick={startEditing} disabled={pending} className="text-xs font-bold disabled:opacity-50" style={{ color: "var(--primary)" }}>
            {pending ? "Drafting…" : thisWeek ? "Edit this week" : "+ Write this week's update"}
          </button>
        )}
      </div>

      {draft && (
        <div className="space-y-2 mb-4">
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{weekLabel(draft.weekOf)} — pre-filled from this week&apos;s numbers; edit before saving. The client sees this.</p>
          {(["wins", "issues", "nextSteps"] as const).map((k) => (
            <label key={k} className="block">
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{k === "nextSteps" ? "Next steps" : k}</span>
              <textarea value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} rows={3} className="w-full px-2 py-1.5 rounded-lg text-sm outline-none mt-0.5" style={input} />
            </label>
          ))}
          <div className="flex gap-2">
            <button onClick={save} disabled={pending} className="btn-gradient px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50">{pending ? "Saving…" : "Publish"}</button>
            <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-lg text-xs font-bold" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>{error}</p>}

      {!latest && !draft && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No weekly updates yet.</p>}
      {latest && !draft && <UpdateBody u={latest} />}
      {older.length > 0 && (
        <>
          <button onClick={() => setShowHistory((s) => !s)} className="text-xs font-bold mt-3" style={{ color: "var(--primary)" }}>
            {showHistory ? "Hide earlier weeks" : `Earlier weeks (${older.length})`}
          </button>
          {showHistory && <div className="mt-2 space-y-4">{older.map((u) => <UpdateBody key={u.id} u={u} />)}</div>}
        </>
      )}
    </div>
  );
}

function UpdateBody({ u }: { u: Update }) {
  return (
    <div>
      <p className="text-[11px] mb-1.5" style={{ color: "var(--text-muted)" }}>{weekLabel(u.weekOf)} · {u.createdBy}</p>
      {([["Wins", u.wins], ["Issues", u.issues], ["Next steps", u.nextSteps]] as const).map(([label, text]) =>
        text ? (
          <div key={label} className="mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</p>
            <p className="text-sm whitespace-pre-line" style={{ color: "var(--text-primary)" }}>{text}</p>
          </div>
        ) : null
      )}
    </div>
  );
}
