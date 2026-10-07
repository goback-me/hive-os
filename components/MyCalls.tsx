"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Health } from "@/lib/client-health";
import { openCallPanel } from "@/lib/url-param";
import CallSlotEditor, { type Slot } from "@/components/CallSlotEditor";
import ClientCallsDropdown, { CALL_STATUS_STYLE, StatusChip, statusKey } from "@/components/ClientCallsDropdown";
import HealthBadge from "@/components/HealthBadge";
import { CALL_CHANGED_EVENT, type CallChange } from "@/components/CallUpdatePanel";

export type CallItem = {
  id: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  scheduledAt: string;
  status: string;
  callPerson: string | null;
  local?: string; // optimistic: "YYYY-MM-DDTHH:MM" Sydney, until the refresh lands
};
type ClientRow = {
  id: string;
  name: string;
  slug: string;
  am: string | null;
  slot: Slot;
  slotLabel: string;
  next: { id: string; at: string } | null;
  last: { id: string; at: string; status: string; review: string | null; outcome: string | null } | null; // review = summary, or why it didn't happen
  health: Health;
};
export type MyCallsData = { now: string; needsUpdate: CallItem[]; today: CallItem[]; week: { start: string; days: string[]; calls: CallItem[] }; clients: ClientRow[] };

const TZ = "Australia/Sydney";
const HOUR = 3_600_000;
const keyOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const hhmm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const localOf = (iso: string) => `${keyOf(iso)}T${hhmm(iso)}`; // for <input type="datetime-local">
const dayKey = (c: CallItem) => c.local?.slice(0, 10) ?? keyOf(c.scheduledAt);
const timeLabel = (c: CallItem) => c.local?.slice(11, 16) ?? hhmm(c.scheduledAt);
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const whenLabel = (iso: string) => `${dateLabel(iso)}, ${hhmm(iso)}`;
const dayHead = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", timeZone: "UTC" });
const shiftDay = (key: string, n: number) => new Date(Date.parse(`${key}T12:00:00Z`) + n * 24 * HOUR).toISOString().slice(0, 10);

function ago(now: number, iso: string) {
  const h = Math.floor((now - new Date(iso).getTime()) / HOUR);
  if (h < 24) return `${Math.max(h, 0)}h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
function startsIn(now: number, iso: string) {
  const m = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (m <= 0) return m > -60 ? "Started" : "Earlier today";
  return m < 60 ? `Starts in ${m} min` : `Starts in ${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
}

// Account Management (app/(app)/account-management): needs update → today →
// the week (drag a call to another day to reschedule) → each client's last
// call (how it went), next call and ▼ history + regular slot. Every call
// opens the update panel.
export default function MyCalls({
  data,
  filter,
  showAm,
  canEditSlot,
  team,
  onSaveSlot,
  onReschedule,
  onSchedule,
}: {
  data: MyCallsData;
  filter: { value: string; team: { id: string; name: string }[] } | null; // whose calls (not for agents)
  showAm: boolean; // viewing everyone's — show each client's AM
  canEditSlot: boolean;
  team: { id: string; name: string }[] | null; // the AM picker in a client's ▼
  onSaveSlot: (clientId: string, slot: Slot) => Promise<void>;
  onReschedule: (callId: string, when: string, reason: string) => Promise<string>;
  onSchedule: (clientId: string, when: string) => Promise<string>;
}) {
  const router = useRouter();
  const [d, setD] = useState(data);
  const [now, setNow] = useState(() => new Date(data.now).getTime());
  const [error, setError] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ call: CallItem; day: string } | null>(null);
  const [openClient, setOpenClient] = useState<string | null>(null);
  useEffect(() => setD(data), [data]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // A save in the panel (or a drag here) → patch the lists now; the refresh follows.
  function apply(ch: CallChange) {
    setD((p) => {
      const patch = (list: CallItem[]) => {
        const old = list.find((c) => c.id === ch.id);
        const next = list.map((c) => (c.id === ch.id ? { ...c, status: ch.status } : c));
        return old && ch.newId && ch.at ? [...next, { ...old, id: ch.newId, status: "PENDING", local: ch.at }] : next;
      };
      return {
        ...p,
        needsUpdate: p.needsUpdate.filter((c) => c.id !== ch.id),
        today: patch(p.today),
        week: { ...p.week, calls: patch(p.week.calls) },
        clients: p.clients.map((c) => (c.next?.id === ch.id && ch.status !== "PENDING" ? { ...c, next: null, last: { id: ch.id, at: c.next.at, status: ch.status, review: null, outcome: null } } : c)),
      };
    });
  }
  useEffect(() => {
    const on = (e: Event) => apply((e as CustomEvent<CallChange>).detail);
    window.addEventListener(CALL_CHANGED_EVENT, on);
    return () => window.removeEventListener(CALL_CHANGED_EVENT, on);
  }, []);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
      router.refresh();
    }
  }

  const query = (o: Record<string, string>) => {
    const p = new URLSearchParams({ ...(filter && filter.value ? { am: filter.value } : {}), week: d.week.start, ...o });
    return `/account-management?${p.toString()}`;
  };
  const card = "card rounded-2xl p-5";
  const h2 = "text-sm font-semibold mb-3 flex items-center gap-2";
  const btn = "px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap";
  const input = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const late = (iso: string) => {
    const h = (now - new Date(iso).getTime()) / HOUR;
    return h > 72 ? { label: ">72h late", bg: "var(--danger-tint)", fg: "var(--danger)" } : h > 24 ? { label: ">24h late", bg: "var(--tag-amber-bg)", fg: "var(--tag-amber-fg)" } : null;
  };

  return (
    <div className="p-4 md:p-10 max-w-[1200px] mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title font-heading" style={{ color: "var(--text-primary)" }}>Account Management</h1>
          <p className="text-base mt-1" style={{ color: "var(--text-secondary)" }}>Client calls — update each one the day it happens.</p>
        </div>
        {filter && (
          <select value={filter.value} onChange={(e) => router.push(query({ am: e.target.value }))} className="px-3 py-2 rounded-lg text-sm" style={input} aria-label="Account manager">
            <option value="all">All account managers</option>
            {filter.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
      {error && <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}

      {/* A — Needs update */}
      <section className={card}>
        <p className={h2} style={{ color: "var(--text-primary)" }}>
          Needs update
          {d.needsUpdate.length > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: "var(--danger)", color: "#fff" }}>{d.needsUpdate.length}</span>}
        </p>
        {d.needsUpdate.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>All caught up.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {d.needsUpdate.map((c) => {
              const l = late(c.scheduledAt);
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium text-sm min-w-[160px]" style={{ color: "var(--text-primary)" }}>{c.clientName}</span>
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{whenLabel(c.scheduledAt)}</span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{ago(now, c.scheduledAt)}</span>
                  {l && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: l.bg, color: l.fg }}>{l.label}</span>}
                  {filter && c.callPerson && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{c.callPerson}</span>}
                  <button type="button" onClick={() => openCallPanel(c.id)} className={`${btn} btn-gradient ml-auto`}>Update</button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* B — Today */}
      <section className={card}>
        <p className={h2} style={{ color: "var(--text-primary)" }}>Today</p>
        {d.today.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>No calls today.</p>
        ) : (
          d.today.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="text-sm font-bold w-12" style={{ color: "var(--text-primary)" }}>{timeLabel(c)}</span>
              <span className="font-medium text-sm min-w-[160px]" style={{ color: "var(--text-primary)" }}>{c.clientName}</span>
              <StatusChip status={c.status} scheduledAt={c.scheduledAt} />
              {c.status === "PENDING" && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{startsIn(now, c.scheduledAt)}</span>}
              {c.status === "PENDING" && (
                <span className="ml-auto flex gap-2">
                  <button type="button" onClick={() => openCallPanel(c.id)} className={`${btn} btn-gradient`}>Log now</button>
                  <button type="button" onClick={() => openCallPanel(c.id, "reschedule")} className={btn} style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Reschedule</button>
                </span>
              )}
            </div>
          ))
        )}
      </section>

      {/* C — Week */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Week of {dayHead(d.week.start)} {new Date(`${d.week.start}T12:00:00Z`).toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" })}
          </p>
          <div className="flex gap-1.5">
            <Link href={query({ week: shiftDay(d.week.start, -7) })} className={btn} style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }} aria-label="Previous week">←</Link>
            <Link href={query({ week: "" })} className={btn} style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>This week</Link>
            <Link href={query({ week: shiftDay(d.week.start, 7) })} className={btn} style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }} aria-label="Next week">→</Link>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {d.week.days.map((day) => {
            const calls = d.week.calls.filter((c) => dayKey(c) === day).sort((a, b) => timeLabel(a).localeCompare(timeLabel(b)));
            const isToday = day === keyOf(new Date(now).toISOString());
            return (
              <div
                key={day}
                className="rounded-xl p-2 min-h-[64px] md:min-h-[120px]"
                style={{ background: "var(--surface-hover)", outline: isToday ? "2px solid var(--primary)" : undefined }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/plain");
                  const call = d.week.calls.find((c) => c.id === id);
                  if (call && dayKey(call) !== day) setDrop({ call, day });
                }}
              >
                <p className="text-[11px] font-bold mb-1.5" style={{ color: isToday ? "var(--primary)" : "var(--text-muted)" }}>{dayHead(day)}</p>
                <div className="space-y-1">
                  {calls.map((c) => {
                    const s = CALL_STATUS_STYLE[statusKey(c.status, c.scheduledAt)];
                    return (
                      <button
                        key={c.id}
                        type="button"
                        draggable={c.status === "PENDING"}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                        onClick={() => openCallPanel(c.id)}
                        className="w-full text-left px-2 py-1 rounded-lg text-[11px] font-semibold truncate"
                        style={{ background: s.bg, color: s.fg, cursor: c.status === "PENDING" ? "grab" : "pointer", textDecoration: c.status === "RESCHEDULED" ? "line-through" : undefined }}
                        title={`${c.clientName} · ${timeLabel(c)} · ${s.label}${c.status === "PENDING" ? " — drag to another day to reschedule" : ""}`}
                      >
                        {timeLabel(c)} {c.clientName}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {Object.values(CALL_STATUS_STYLE).map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.bg, border: `1px solid ${s.fg}` }} />
              {s.label}
            </span>
          ))}
        </div>
      </section>

      {/* D — Clients: how the last call went, the next one, ▼ everything */}
      <section className={card}>
        <p className={h2} style={{ color: "var(--text-primary)" }}>Clients ({d.clients.length})</p>
        <div className="space-y-2">
          {d.clients.map((c) => (
            <div key={c.id} className="rounded-xl" style={{ border: "1px solid var(--border)", background: c.next ? undefined : "var(--tag-amber-bg)" }}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
                <button type="button" onClick={() => setOpenClient(openClient === c.id ? null : c.id)} className="flex-1 min-w-[260px] text-left" aria-expanded={openClient === c.id}>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{c.name}</span>
                    <HealthBadge health={c.health} />
                    {showAm && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{c.am ?? "No account manager"}</span>}
                  </span>
                  {c.last ? (
                    <span className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                      <span style={{ color: "var(--text-muted)" }}>Last call {dateLabel(c.last.at)}</span>
                      <StatusChip status={c.last.status} scheduledAt={c.last.at} />
                      {c.last.outcome && <span style={{ color: c.last.outcome === "At risk" ? "var(--danger)" : "var(--text-muted)" }}>{c.last.outcome}</span>}
                      {c.last.review && <span className="truncate max-w-[420px]">— {c.last.review}</span>}
                    </span>
                  ) : (
                    <span className="block mt-1 text-xs" style={{ color: "var(--text-muted)" }}>No calls yet</span>
                  )}
                </button>
                <span className="text-sm" style={{ color: c.next ? "var(--text-primary)" : "var(--tag-amber-fg)" }}>
                  {c.next ? (
                    <>
                      Next: <b>{whenLabel(c.next.at)}</b>
                    </>
                  ) : c.slot.accountManagerId ? (
                    "No call booked"
                  ) : (
                    "No account manager"
                  )}
                </span>
                {c.next ? (
                  <span className="flex gap-1.5">
                    <button type="button" onClick={() => openCallPanel(c.next!.id, "reschedule")} className={btn} style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                      Reschedule
                    </button>
                    <button type="button" onClick={() => openCallPanel(c.next!.id)} className={`${btn} btn-gradient`}>
                      Log
                    </button>
                  </span>
                ) : (
                  <ScheduleInline onSchedule={(when) => run(() => onSchedule(c.id, when))} />
                )}
                <Link href={`/clients/${c.slug}?tab=weekly`} className="material-symbols-outlined text-[18px]" style={{ color: "var(--text-muted)" }} aria-label={`Open ${c.name}`} title="Open client">
                  open_in_new
                </Link>
                <button type="button" onClick={() => setOpenClient(openClient === c.id ? null : c.id)} className="material-symbols-outlined" style={{ color: "var(--text-muted)" }} aria-label={`${c.name}'s calls`}>
                  {openClient === c.id ? "expand_less" : "expand_more"}
                </button>
              </div>
              {openClient === c.id && (
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                    Regular call:
                    {canEditSlot ? <CallSlotEditor clientId={c.id} initial={c.slot} team={team} onSave={onSaveSlot} compact /> : <span style={{ color: "var(--text-secondary)" }}>{c.slotLabel}</span>}
                  </div>
                  <ClientCallsDropdown clientId={c.id} />
                </div>
              )}
            </div>
          ))}
        </div>
        {d.clients.length === 0 && <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>No active clients here — a coach sets the account manager on each client.</p>}
      </section>

      {drop && (
        <RescheduleDrop
          call={drop.call}
          day={drop.day}
          onCancel={() => setDrop(null)}
          onConfirm={async (when, reason) => {
            const { call } = drop;
            setDrop(null);
            await run(async () => {
              const newId = await onReschedule(call.id, when, reason);
              apply({ id: call.id, status: "RESCHEDULED", newId, at: when });
            });
          }}
        />
      )}
    </div>
  );
}

function ScheduleInline({ onSchedule }: { onSchedule: (when: string) => void }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="px-3 py-1 rounded-lg text-xs font-bold" style={{ background: "var(--tag-amber-fg)", color: "#fff" }}>
        Schedule
      </button>
    );
  }
  return (
    <span className="flex gap-1">
      <input type="datetime-local" step={900} value={when} onChange={(e) => setWhen(e.target.value)} className="px-2 py-1 rounded-lg text-xs outline-none" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} aria-label="Call date and time" />
      <button type="button" disabled={!when} onClick={() => onSchedule(when)} className="btn-gradient px-2 py-1 rounded-lg text-xs font-bold disabled:opacity-40">Book</button>
    </span>
  );
}

// Dropping a call on another day: same time by default, optional reason.
function RescheduleDrop({ call, day, onCancel, onConfirm }: { call: CallItem; day: string; onCancel: () => void; onConfirm: (when: string, reason: string) => void }) {
  const [time, setTime] = useState(timeLabel(call));
  const [reason, setReason] = useState("");
  const input = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onCancel} role="dialog" aria-modal="true" aria-label="Reschedule call">
      <div className="card rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-heading font-bold text-lg" style={{ color: "var(--text-primary)" }}>Reschedule {call.clientName}?</h3>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          From {dateLabel(call.scheduledAt)} to {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}
        </p>
        <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
          Time
          <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} className="block mt-1 px-2 py-1.5 rounded-lg text-sm outline-none" style={input} />
        </label>
        <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
          Reason (optional)
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="block w-full mt-1 px-2 py-1.5 rounded-lg text-sm outline-none" style={input} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Cancel</button>
          <button type="button" disabled={!time} onClick={() => onConfirm(`${day}T${time}`, reason)} className="btn-gradient px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-40">Reschedule</button>
        </div>
      </div>
    </div>
  );
}
