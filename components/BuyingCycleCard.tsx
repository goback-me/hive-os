"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CycleStep, StepCycle } from "@/lib/buying-cycle";

export type CycleRow = StepCycle & { step: CycleStep; label: string; noun: [string, string]; override: number | null };

const fmtDays = (d: number) => `${Math.round(d)} day${Math.round(d) === 1 ? "" : "s"}`;

// Coach-only: this client's buying cycle (lib/buying-cycle.ts) — what each
// step usually takes, where that number comes from, and an override. The
// reminder schedule runs off these numbers.
export default function BuyingCycleCard({
  clientId,
  rows,
  computedAt,
  onSave,
  onRecalculate,
}: {
  clientId: string;
  rows: CycleRow[];
  computedAt: string | null;
  onSave: (clientId: string, overrides: Partial<Record<CycleStep, number | null>>) => Promise<void>;
  onRecalculate: (clientId: string) => Promise<void>;
}) {
  const router = useRouter();
  const initial = Object.fromEntries(rows.map((r) => [r.step, r.override == null ? "" : String(r.override)])) as Record<CycleStep, string>;
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const input = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const quote = rows.find((r) => r.step === "quoteToClose");

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      setError(null);
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });

  return (
    <div className="card rounded-2xl p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Buying cycle</p>
        {quote && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            Typical quote → close: <b>{fmtDays(quote.medianDays)}</b>{" "}
            {quote.source === "learned" ? `(from ${quote.n} ${quote.noun[quote.n === 1 ? 0 : 1]})` : quote.source === "override" ? "(set by a coach)" : "(default — not enough closed deals yet)"}
          </p>
        )}
      </div>

      {rows.map((r) => (
        <div key={r.step} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{r.label}: {fmtDays(r.medianDays)}</p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {r.learnedDays != null ? `Learned ${fmtDays(r.learnedDays)} from ${r.n} ${r.noun[r.n === 1 ? 0 : 1]}` : `Nothing learned yet (${r.n} ${r.noun[1]})`}
              {r.source === "default" && " · using the default"}
              {r.source === "override" && " · overridden"}
            </p>
          </div>
          <input
            type="number"
            min={1}
            value={form[r.step]}
            onChange={(e) => setForm({ ...form, [r.step]: e.target.value })}
            placeholder="Override"
            className="w-20 px-2 py-1.5 rounded-lg text-xs outline-none"
            style={input}
            aria-label={`${r.label} override (days)`}
          />
        </div>
      ))}

      <div className="flex items-center gap-3">
        {dirty && (
          <button
            onClick={() => run(() => onSave(clientId, Object.fromEntries(rows.map((r) => [r.step, form[r.step].trim() ? Number(form[r.step]) : null]))))}
            disabled={pending}
            className="btn-gradient px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save overrides"}
          </button>
        )}
        <button onClick={() => run(() => onRecalculate(clientId))} disabled={pending} className="text-xs font-bold disabled:opacity-40" style={{ color: "var(--primary)" }}>
          Recalculate
        </button>
        {computedAt && (
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Learned {new Date(computedAt).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" })}
          </span>
        )}
      </div>
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
