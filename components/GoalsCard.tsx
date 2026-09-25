"use client";

import { useState, useTransition } from "react";

export default function GoalsCard({
  clientId,
  initialGoals,
  onSave,
}: {
  clientId: string;
  initialGoals: string | null;
  onSave: (clientId: string, goals: string) => Promise<void>;
}) {
  const [goals, setGoals] = useState(initialGoals ?? "");
  const [draft, setDraft] = useState(goals);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      await onSave(clientId, draft);
      setGoals(draft.trim());
      setEditing(false);
    });

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Goals</p>
        {!editing && (
          <button
            onClick={() => { setDraft(goals); setEditing(true); }}
            className="text-xs font-semibold flex items-center gap-1"
            style={{ color: "var(--primary)" }}
          >
            <span className="material-symbols-outlined text-[14px]">{goals ? "edit" : "add"}</span>
            {goals ? "Edit" : "Add goals"}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            autoFocus
            placeholder="e.g. Hit $100K/month in booked jobs by end of year."
            className="w-full px-3 py-2 rounded-lg outline-none text-sm resize-y"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setEditing(false)} disabled={pending} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              Cancel
            </button>
            <button onClick={save} disabled={pending} className="px-3 py-1.5 rounded-lg text-xs font-bold btn-cta" style={{ background: "var(--secondary)", color: "#fff" }}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm whitespace-pre-line" style={{ color: goals ? "var(--text-primary)" : "var(--text-secondary)" }}>
          {goals || "No goals recorded yet."}
        </p>
      )}
    </div>
  );
}
