"use client";

import { useState } from "react";

type Note = { id: string; note: string; createdBy: string; createdAt: string };

// A client component (rather than the raw <form action={...}> this used to
// be) so a new note shows up the instant it's added — that plain form lived
// inside ClientTabsShell's client-side tab switcher, and the implicit
// re-render Next.js does after a Server Action wasn't reliably reaching
// through that boundary to update the list. Explicit client state fixes it,
// and lets the input clear itself on submit too.
export default function ProgressNotesPanel({
  clientId,
  initialNotes,
  onAddNote,
}: {
  clientId: string;
  initialNotes: Note[];
  onAddNote: (clientId: string, formData: FormData) => Promise<void>;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadNotes() {
    fetch(`/api/progress-notes?clientId=${clientId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setNotes(data.notes);
      })
      .catch((e) => setError(e.message));
  }

  function submit() {
    if (!draft.trim()) return;
    setSaving(true);
    setError(null);
    const formData = new FormData();
    formData.set("note", draft.trim());
    onAddNote(clientId, formData)
      .then(() => {
        setDraft("");
        loadNotes();
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  }

  return (
    <div className="card rounded-2xl p-5">
      <p className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Progress Notes</p>
      {error && <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>{error}</p>}
      {notes.length === 0 ? (
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>No notes yet — add one after a session.</p>
      ) : (
        <div className="space-y-4 mb-4">
          {notes.map((n) => (
            <div key={n.id} className="flex gap-3">
              <span className="icon-chip w-8 h-8 shrink-0" style={{ background: "var(--primary-tint)" }}>
                <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--primary)" }}>edit_note</span>
              </span>
              <div className="min-w-0">
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>{n.note}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {n.createdBy} · {new Date(n.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Add a note…"
          style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          className="px-3 py-2 rounded-lg outline-none text-sm"
        />
        <button
          onClick={submit}
          disabled={saving || !draft.trim()}
          className="px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
          style={{ background: "var(--primary)", color: "#fff" }}
        >
          {saving ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
