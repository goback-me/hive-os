"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Contact = { id: string; contactedAt: string; method: string; loggedBy: string; notes: string | null; nextStep: string | null; nextStepDue: string | null };

const ICON: Record<string, string> = { call: "call", meeting: "groups", message: "chat", email: "mail" };
const sydDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric" });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());

// Coach only: account-manager check-ins with this client. The latest is the
// portfolio's "Last contact"; 10+ days without one is a Needs Action item.
export default function ContactLogPanel({
  clientId,
  me,
  initial,
  onLog,
}: {
  clientId: string;
  me: string;
  initial: Contact[];
  onLog: (clientId: string, formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await onLog(clientId, formData);
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  const last = initial[0];
  const daysSince = last ? Math.floor((Date.now() - new Date(last.contactedAt).getTime()) / 86_400_000) : null;

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex justify-between items-center mb-1">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Account management</p>
        <button onClick={() => setOpen((o) => !o)} className="text-xs font-bold" style={{ color: "var(--primary)" }}>{open ? "Cancel" : "+ Log contact"}</button>
      </div>
      <p className="text-xs mb-3" style={{ color: daysSince != null && daysSince < 10 ? "var(--text-muted)" : "var(--danger)" }}>
        {daysSince == null ? "No contact logged yet" : `Last contact ${daysSince === 0 ? "today" : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`}`}
      </p>

      {open && (
        <form action={submit} className="space-y-2 mb-4">
          <div className="grid grid-cols-2 gap-2">
            <input type="date" name="date" defaultValue={today()} required className="px-2 py-1.5 rounded-lg text-sm outline-none" style={input} aria-label="Date" />
            <select name="type" defaultValue="call" className="px-2 py-1.5 rounded-lg text-sm outline-none" style={input} aria-label="Type">
              <option value="call">Call</option>
              <option value="meeting">Meeting</option>
              <option value="message">Message</option>
            </select>
          </div>
          <input name="who" defaultValue={me} placeholder="Who (from Hive)" className="w-full px-2 py-1.5 rounded-lg text-sm outline-none" style={input} aria-label="Who" />
          <textarea name="notes" rows={2} placeholder="Notes" className="w-full px-2 py-1.5 rounded-lg text-sm outline-none resize-none" style={input} aria-label="Notes" />
          <div className="grid grid-cols-3 gap-2">
            <input name="nextStep" placeholder="Next step" className="col-span-2 px-2 py-1.5 rounded-lg text-sm outline-none" style={input} aria-label="Next step" />
            <input type="date" name="nextStepDue" className="px-2 py-1.5 rounded-lg text-sm outline-none" style={input} aria-label="Next step due" />
          </div>
          {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
          <button disabled={pending} className="btn-gradient px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
        </form>
      )}

      <div className="space-y-2">
        {initial.map((c) => (
          <div key={c.id} className="flex items-start gap-2 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="material-symbols-outlined text-[16px] mt-0.5" style={{ color: "var(--text-muted)" }}>{ICON[c.method] ?? "call"}</span>
            <div className="min-w-0">
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                <strong style={{ color: "var(--text-primary)" }}>{sydDate(c.contactedAt)}</strong> · {c.method} · {c.loggedBy}
              </p>
              {c.notes && <p className="text-xs whitespace-pre-line" style={{ color: "var(--text-primary)" }}>{c.notes}</p>}
              {c.nextStep && (
                <p className="text-[11px]" style={{ color: "var(--primary)" }}>
                  Next: {c.nextStep}
                  {c.nextStepDue && ` (by ${sydDate(c.nextStepDue)})`}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
