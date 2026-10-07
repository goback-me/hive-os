"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type Slot = { accountManagerId: string | null; callDay: string; callTime: string; callFrequency: string };

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const dayLabel = (d: string) => d.charAt(0) + d.slice(1, 3).toLowerCase();

// A client's account manager + regular call slot ("Every Mon 10:00"), saved
// on change (saveCallSlot — the next call follows). `team` null = no AM
// picker (e.g. a row that already shows the AM).
export default function CallSlotEditor({
  clientId,
  initial,
  team,
  onSave,
  compact,
}: {
  clientId: string;
  initial: Slot;
  team: { id: string; name: string }[] | null;
  onSave: (clientId: string, slot: Slot) => Promise<void>;
  compact?: boolean;
}) {
  const router = useRouter();
  const [slot, setSlot] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const style = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const cls = `px-2 py-1 rounded-lg ${compact ? "text-[11px]" : "text-xs"} outline-none`;

  function save(patch: Partial<Slot>) {
    const next = { ...slot, ...patch };
    const before = slot;
    setSlot(next);
    setError(null);
    startTransition(async () => {
      try {
        await onSave(clientId, next);
        router.refresh();
      } catch (e) {
        setSlot(before);
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" style={{ opacity: pending ? 0.6 : 1 }}>
      {team && (
        <select value={slot.accountManagerId ?? ""} onChange={(e) => save({ accountManagerId: e.target.value || null })} className={cls} style={style} aria-label="Account manager">
          <option value="">No account manager</option>
          {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )}
      <select value={slot.callFrequency} onChange={(e) => save({ callFrequency: e.target.value })} className={cls} style={style} aria-label="How often">
        <option value="WEEKLY">Every</option>
        <option value="FORTNIGHTLY">Every 2nd</option>
      </select>
      <select value={slot.callDay} onChange={(e) => save({ callDay: e.target.value })} className={cls} style={style} aria-label="Call day">
        {DAYS.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
      </select>
      <input
        key={slot.callTime}
        type="time"
        step={900}
        defaultValue={slot.callTime}
        onBlur={(e) => e.target.value && e.target.value !== slot.callTime && save({ callTime: e.target.value })}
        className={cls}
        style={style}
        aria-label="Call time"
      />
      {error && <span className="text-[11px]" style={{ color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}
