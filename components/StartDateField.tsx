"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Client Details → reporting start date (onboarding day). Coaches edit it;
// a client just sees it. Saves on change.
export default function StartDateField({
  clientId,
  initial,
  isCoach,
  onSave,
}: {
  clientId: string;
  initial: string; // "YYYY-MM-DD" (Sydney) or ""
  isCoach: boolean;
  onSave: (clientId: string, day: string) => Promise<void>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(day: string) {
    const prev = value;
    setValue(day);
    setError(null);
    startTransition(async () => {
      try {
        await onSave(clientId, day);
        router.refresh();
      } catch (e) {
        setValue(prev);
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  return (
    <div className="flex items-start gap-2.5">
      <span className="material-symbols-outlined text-[16px] mt-0.5" style={{ color: "var(--text-muted)" }}>flag</span>
      <div className="min-w-0 flex-1">
        <dt className="text-xs" style={{ color: "var(--text-muted)" }}>Start date (reports count from)</dt>
        <dd className="font-medium" style={{ color: "var(--text-primary)" }}>
          {isCoach ? (
            <input
              type="date"
              value={value}
              disabled={pending}
              onChange={(e) => save(e.target.value)}
              className="px-2 py-1 rounded-lg text-sm outline-none mt-0.5"
              style={{ background: "var(--surface)", border: `1px solid ${value ? "var(--border)" : "var(--tag-amber-fg)"}`, color: "var(--text-primary)" }}
            />
          ) : value ? (
            new Date(`${value}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
          ) : (
            "—"
          )}
        </dd>
        {isCoach && !value && <p className="text-[11px] mt-1" style={{ color: "var(--tag-amber-fg)" }}>Set client start date for accurate reporting</p>}
        {error && <p className="text-[11px] mt-1" style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
    </div>
  );
}

export function StartDateWarning() {
  return (
    <div className="rounded-xl p-3 mb-4 flex items-center gap-2 text-sm" style={{ background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }}>
      <span className="material-symbols-outlined text-[18px]">warning</span>
      Set client start date for accurate reporting (Dashboard → Client Details).
    </div>
  );
}
