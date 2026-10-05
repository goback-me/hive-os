"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Meeting = { id: string; weekOf: string; status: "PENDING" | "HELD" | "NOT_HELD"; mood: string | null };

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const dayLabel = (d: string) => d.charAt(0) + d.slice(1).toLowerCase();
const sydDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short" });

// The weekly client call (lib/weekly-meetings.ts): who runs it and on which
// day (coaches pick), and the recent calls — open ones link to the log form.
export default function WeeklyCallCard({
  clientId,
  clientSlug,
  agentId,
  day,
  team,
  meetings,
  onSave,
}: {
  clientId: string;
  clientSlug: string;
  agentId: string | null;
  day: string;
  team: { id: string; name: string }[] | null; // null = can't change (agents)
  meetings: Meeting[];
  onSave: (clientId: string, agentId: string | null, day: string) => Promise<void>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const select = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const save = (a: string | null, d: string) =>
    startTransition(async () => {
      setError(null);
      try {
        await onSave(clientId, a, d);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });

  return (
    <div className="card rounded-2xl p-5 space-y-3">
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Weekly call</p>
      {team ? (
        <div className="flex gap-2">
          <select value={agentId ?? ""} onChange={(e) => save(e.target.value || null, day)} disabled={pending} className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none" style={select} aria-label="Weekly call agent">
            <option value="">No agent</option>
            {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={day} onChange={(e) => save(agentId, e.target.value)} disabled={pending} className="px-2 py-1.5 rounded-lg text-xs outline-none" style={select} aria-label="Weekly call day">
            {DAYS.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
          </select>
        </div>
      ) : (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Every {dayLabel(day)}</p>
      )}
      {meetings.length ? (
        <div className="space-y-1">
          {meetings.map((m) => (
            <Link key={m.id} href={`/clients/${clientSlug}/meetings/${m.id}`} className="flex items-center justify-between text-xs py-1">
              <span style={{ color: "var(--text-primary)" }}>{sydDate(m.weekOf)}</span>
              <span
                className="px-2 py-0.5 rounded-full font-bold"
                style={
                  m.status === "PENDING"
                    ? { background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }
                    : m.status === "NOT_HELD"
                    ? { background: "var(--danger-tint)", color: "var(--danger)" }
                    : { background: "var(--tag-green-bg)", color: "var(--tag-green-fg)" }
                }
              >
                {m.status === "PENDING" ? "Log it" : m.status === "NOT_HELD" ? "Didn't happen" : `Held${m.mood ? ` · ${m.mood}` : ""}`}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{agentId ? "The first call shows up here the Monday after it." : "Pick who runs the call to start logging it."}</p>
      )}
      {error && <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}
