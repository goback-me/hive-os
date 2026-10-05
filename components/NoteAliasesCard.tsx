"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Coach-only: who's who in this client's feedback cell. One per line,
// "mddy = Maddy". "hs" is the Hive call team unless set here.
export default function NoteAliasesCard({
  clientId,
  initial,
  onSave,
}: {
  clientId: string;
  initial: Record<string, string>;
  onSave: (clientId: string, text: string) => Promise<void>;
}) {
  const router = useRouter();
  const start = Object.entries(initial).map(([k, v]) => `${k} = ${v}`).join("\n");
  const [text, setText] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setError(null);
      try {
        await onSave(clientId, text);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });

  return (
    <div className="card rounded-2xl p-5 space-y-2">
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Feedback names</p>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Who the names at the start of each feedback entry are. One per line, e.g. <code>mddy = Maddy</code>. &ldquo;hs&rdquo; is the Hive call team.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={"mddy = Maddy\nal = Alex"}
        className="w-full px-2 py-1.5 rounded-lg text-xs outline-none resize-none font-mono"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        aria-label="Feedback name aliases"
      />
      {text !== start && (
        <button onClick={save} disabled={pending} className="btn-gradient px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
      )}
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
