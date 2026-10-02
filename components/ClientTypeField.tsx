"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CLIENT_TYPE_LABELS, type ClientTypeValue } from "@/lib/client-terms";

// Client Details → client type. TRADE switches report wording to "Onsite
// quote" / "Job won". Coaches edit; a client just sees it.
export default function ClientTypeField({
  clientId,
  initial,
  isCoach,
  onSave,
}: {
  clientId: string;
  initial: ClientTypeValue;
  isCoach: boolean;
  onSave: (clientId: string, clientType: string) => Promise<void>;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: ClientTypeValue) {
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      try {
        await onSave(clientId, next);
        router.refresh();
      } catch (e) {
        setValue(prev);
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  return (
    <div className="flex items-start gap-2.5">
      <span className="material-symbols-outlined text-[16px] mt-0.5" style={{ color: "var(--text-muted)" }}>category</span>
      <div className="min-w-0 flex-1">
        <dt className="text-xs" style={{ color: "var(--text-muted)" }}>Client type</dt>
        <dd className="font-medium" style={{ color: "var(--text-primary)" }}>
          {isCoach ? (
            <select
              value={value}
              disabled={pending}
              onChange={(e) => save(e.target.value as ClientTypeValue)}
              className="px-2 py-1 rounded-lg text-sm outline-none mt-0.5"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            >
              {(Object.keys(CLIENT_TYPE_LABELS) as ClientTypeValue[]).map((t) => (
                <option key={t} value={t}>{CLIENT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          ) : (
            CLIENT_TYPE_LABELS[value]
          )}
        </dd>
        {isCoach && value === "TRADE" && <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>Reports say &ldquo;Onsite quote&rdquo; and &ldquo;Job won&rdquo;.</p>}
        {error && <p className="text-[11px] mt-1" style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
    </div>
  );
}
