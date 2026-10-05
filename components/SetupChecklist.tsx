"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type SetupItem = { key: string; label: string; ok: boolean; paused: string; fix: string; href?: string };

// Coach-only: what this client's automations still need. Each missing item
// says what's paused because of it and where to fix it; nothing here is an
// error — the automation just waits. The client email can be added inline.
// Hidden once everything's set.
export default function SetupChecklist({
  clientId,
  items,
  onSaveEmail,
}: {
  clientId: string;
  items: SetupItem[];
  onSaveEmail: (clientId: string, email: string) => Promise<void>;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const missing = items.filter((i) => !i.ok);
  if (!missing.length) return null;

  const saveEmail = () =>
    startTransition(async () => {
      setError(null);
      try {
        await onSaveEmail(clientId, email);
        setEmail("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });

  return (
    <div className="card rounded-2xl p-5 mb-6" style={{ borderLeft: "4px solid var(--tag-amber-fg)" }}>
      <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
        <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--tag-amber-fg)" }}>checklist</span>
        Automation setup — {missing.length} thing{missing.length === 1 ? "" : "s"} still to set up
      </p>
      <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>Nothing is broken — these automations are just paused for this client until they&apos;re set.</p>
      <div className="space-y-2">
        {missing.map((i) => (
          <div key={i.key} className="flex items-start gap-3 text-xs flex-wrap">
            <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--tag-amber-fg)" }}>pause_circle</span>
            <div className="flex-1 min-w-[220px]">
              <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{i.label}</p>
              <p style={{ color: "var(--text-secondary)" }}>
                Paused: {i.paused}. {i.href ? <a href={i.href} className="font-semibold" style={{ color: "var(--primary)" }}>{i.fix}</a> : i.fix}
              </p>
            </div>
            {i.key === "email" && (
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@client.com.au"
                  className="px-2 py-1.5 rounded-lg text-xs outline-none w-48"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                  aria-label="Client email"
                />
                <button onClick={saveEmail} disabled={pending || !email.trim()} className="btn-gradient px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40">
                  {pending ? "Saving…" : "Add"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-xs mt-2" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
