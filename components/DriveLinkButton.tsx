"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// The client's Google Drive folder, in the client page header: opens Drive
// in a new tab for everyone; the team can add or change the link here.
export default function DriveLinkButton({ clientId, link, canEdit, onSave }: { clientId: string; link: string | null; canEdit: boolean; onSave: (clientId: string, formData: FormData) => Promise<void> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const pill = "px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1";

  if (editing) {
    return (
      <form
        className="flex items-center gap-1.5"
        action={(fd) =>
          startTransition(async () => {
            setError(null);
            try {
              await onSave(clientId, fd);
              setEditing(false);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't save");
            }
          })
        }
      >
        <input
          name="figmaLink"
          defaultValue={link ?? ""}
          autoFocus
          placeholder="https://drive.google.com/…"
          className="w-72 px-2.5 py-1 rounded-full text-xs outline-none"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          aria-label="Google Drive link"
        />
        <button disabled={pending} className="btn-gradient px-3 py-1 rounded-full text-xs font-bold disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Cancel</button>
        {error && <span className="text-xs" style={{ color: "var(--danger)" }}>{error}</span>}
      </form>
    );
  }
  if (!link) {
    return canEdit ? (
      <button type="button" onClick={() => setEditing(true)} className={pill} style={{ border: "1px dashed var(--border)", color: "var(--text-secondary)" }}>
        <span className="material-symbols-outlined text-[14px]">add</span> Google Drive
      </button>
    ) : null;
  }
  return (
    <span className="flex items-center gap-1">
      <a href={link} target="_blank" rel="noopener noreferrer" className={pill} style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}>
        <span className="material-symbols-outlined text-[14px]">folder_open</span> Google Drive
      </a>
      {canEdit && (
        <button type="button" onClick={() => setEditing(true)} className="material-symbols-outlined text-[16px]" style={{ color: "var(--text-muted)" }} aria-label="Change the Google Drive link" title="Change link">
          edit
        </button>
      )}
    </span>
  );
}
