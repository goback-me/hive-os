"use client";

import { Fragment, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AccountManagementData, AmPerson, WeekCell } from "@/lib/account-management";
import { reportRangeQuery, type ReportRange } from "@/lib/date-range";
import { setUrlParam } from "@/lib/url-param";
import DateRangePicker from "@/components/DateRangePicker";
import ClientCallsDropdown, { StatusChip } from "@/components/ClientCallsDropdown";
import HealthBadge from "@/components/HealthBadge";

const TZ = "Australia/Sydney";
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: TZ, day: "numeric", month: "short" });
const weekLabel = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

const CELL: Record<WeekCell, { label: string; bg: string; fg: string }> = {
  HELD: { label: "Held", bg: "var(--tag-green-bg)", fg: "var(--tag-green-fg)" },
  NOT_HELD: { label: "Didn't happen", bg: "var(--danger-tint)", fg: "var(--danger)" },
  NOT_LOGGED: { label: "Not logged", bg: "var(--tag-amber-bg)", fg: "var(--tag-amber-fg)" },
  RESCHEDULED: { label: "Rescheduled", bg: "var(--tag-purple-bg)", fg: "var(--tag-purple-fg)" },
  UPCOMING: { label: "Upcoming", bg: "var(--primary-tint)", fg: "var(--primary)" },
  NONE: { label: "No call", bg: "var(--surface-hover)", fg: "var(--text-muted)" },
};
const CELL_MARK: Record<WeekCell, string> = { HELD: "✓", NOT_HELD: "✕", NOT_LOGGED: "!", RESCHEDULED: "↻", UPCOMING: "•", NONE: "" };
const TREND = { up: { icon: "trending_up", color: "var(--tag-green-fg)", label: "Numbers up vs last month" }, down: { icon: "trending_down", color: "var(--danger)", label: "Numbers down vs last month" }, flat: { icon: "trending_flat", color: "var(--text-muted)", label: "About the same as last month" } };

// Account Management: cards for the range, then the client table (a row
// expands its call history inline — never navigates; ↗ opens the client),
// AM performance (admins) or the 8-week grid. Filters live in the URL.
export default function AccountManagement({
  data,
  range,
  maxFrom,
  am,
  view,
  showPerformance,
}: {
  data: AccountManagementData;
  range: ReportRange;
  maxFrom: string | null;
  am: { value: string; team: { id: string; name: string }[] } | null;
  view: "clients" | "performance" | "grid";
  showPerformance: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState<string | null>(sp.get("open"));
  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    setUrlParam("open", next);
  };
  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    router.push(`/account-management?${p.toString()}`, { scroll: false });
  };
  const setRange = (r: ReportRange) => {
    const p = new URLSearchParams(sp.toString());
    ["range", "from", "to"].forEach((k) => p.delete(k));
    new URLSearchParams(reportRangeQuery(r)).forEach((v, k) => p.set(k, v));
    router.push(`/account-management?${p.toString()}`, { scroll: false });
  };
  const exportHref = `/api/account-management/export?${new URLSearchParams([...(am ? [["am", am.value]] : []), ...new URLSearchParams(reportRangeQuery(range))]).toString()}`;
  const c = data.cards;
  const input = { background: "var(--surface-card)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const tab = (key: typeof view, label: string) => (
    <button
      type="button"
      onClick={() => go({ view: key === "clients" ? null : key })}
      className="pb-3 text-sm font-semibold"
      style={{ color: view === key ? "var(--primary)" : "var(--text-secondary)", borderBottom: view === key ? "3px solid var(--primary)" : "3px solid transparent" }}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 md:p-10 max-w-[1400px] mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title font-heading" style={{ color: "var(--text-primary)" }}>Account Management</h1>
          <p className="text-base mt-1" style={{ color: "var(--text-secondary)" }}>Every client&apos;s calls and health — who&apos;s keeping up, and who needs attention.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {am && (
            <select value={am.value} onChange={(e) => go({ am: e.target.value, open: null })} className="px-3 py-2 rounded-lg text-sm" style={input} aria-label="Account manager">
              <option value="all">All account managers</option>
              {am.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <DateRangePicker value={range} onChange={setRange} maxFrom={maxFrom} />
          <a href={exportHref} className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1" style={{ border: "1px solid var(--border)", color: "var(--text-primary)" }}>
            <span className="material-symbols-outlined text-[16px]">download</span> CSV
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Card label="Calls due" value={c.due} />
        <Card label="Held" value={c.held} sub={pct(c.held, c.due)} />
        <Card label="Rescheduled" value={c.rescheduled} sub={pct(c.rescheduled, c.due)} />
        <Card label="Didn't happen" value={c.notHeld} sub={pct(c.notHeld, c.due)} tone={c.notHeld ? "warn" : undefined} />
        <Card label="Not logged" value={c.notLogged} sub={pct(c.notLogged, c.due)} tone={c.notLogged ? "bad" : undefined} />
        <Card label="At risk / critical" value={`${c.atRisk} / ${c.critical}`} tone={c.critical ? "bad" : c.atRisk ? "warn" : undefined} />
        <Card label="Updates emailed" value={c.emailed} />
        <Card label="Logged ≤24h of reminder" value={c.onTimePct == null ? "—" : `${c.onTimePct}%`} />
      </div>
      {c.perAm.length > 1 && (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Calls held per AM: {c.perAm.map((p) => `${p.name} ${p.held}`).join(" · ")}
        </p>
      )}

      <div className="flex gap-6" style={{ borderBottom: "1px solid var(--border)" }}>
        {tab("clients", "Clients")}
        {showPerformance && tab("performance", "AM performance")}
        {tab("grid", "Weekly grid")}
      </div>

      {view === "clients" && (
        <div className="card rounded-2xl p-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="text-left text-xs" style={{ color: "var(--text-muted)" }}>
                {["Client", "AM", "Regular call", "Next call", "Last call", "Outcome", "Health", "Latest internal note", "Waiting", "KPIs", ""].map((h) => (
                  <th key={h} className="font-medium py-1.5 pr-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.clients.map((r) => {
                const t = TREND[r.trend];
                return (
                  <Fragment key={r.id}>
                    <tr
                      onClick={() => toggle(r.id)}
                      className="cursor-pointer"
                      style={{ borderTop: "1px solid var(--border)", background: open === r.id ? "var(--surface-hover)" : r.next ? undefined : "var(--tag-amber-bg)" }}
                      aria-expanded={open === r.id}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{r.name}</span>
                        <a href={`/clients/${r.slug}`} onClick={(e) => e.stopPropagation()} className="ml-1.5 material-symbols-outlined text-[14px] align-middle" style={{ color: "var(--text-muted)" }} title="Open client" aria-label={`Open ${r.name}`}>
                          open_in_new
                        </a>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{r.am ?? "—"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{r.slot}</td>
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: r.next ? "var(--text-secondary)" : "var(--tag-amber-fg)" }}>{r.next ? when(r.next.at) : "Not booked"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{r.last ? <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>{dateOnly(r.last.at)} <StatusChip status={r.last.status} scheduledAt={r.last.at} /></span> : "—"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap" style={{ color: r.outcome === "At risk" ? "var(--danger)" : "var(--text-secondary)" }}>{r.outcome ?? "—"}</td>
                      <td className="py-2 pr-3"><HealthBadge health={r.health} /></td>
                      <td className="py-2 pr-3 max-w-[220px] truncate text-xs" style={{ color: "var(--text-secondary)" }} title={r.comment ?? undefined}>{r.comment ?? "—"}</td>
                      <td className="py-2 pr-3" style={{ color: r.awaiting ? "var(--text-primary)" : "var(--text-muted)" }}>{r.awaiting || "—"}</td>
                      <td className="py-2 pr-3"><span className="material-symbols-outlined text-[18px]" style={{ color: t.color }} title={t.label} aria-label={t.label}>{t.icon}</span></td>
                      <td className="py-2 text-right"><span className="material-symbols-outlined text-[18px]" style={{ color: "var(--text-muted)" }}>{open === r.id ? "expand_less" : "expand_more"}</span></td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={11} className="pb-3">
                          <ClientCallsDropdown clientId={r.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {data.clients.length === 0 && <p className="text-sm p-4" style={{ color: "var(--text-muted)" }}>No clients for this account manager.</p>}
        </div>
      )}

      {view === "performance" && <Performance people={data.people} />}

      {view === "grid" && (
        <div className="card rounded-2xl p-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-xs" style={{ color: "var(--text-muted)" }}>
                <th className="text-left font-medium py-1.5">Client</th>
                {data.grid.weeks.map((w) => <th key={w} className="font-medium py-1.5">{weekLabel(w)}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.grid.rows.map((r) => (
                <Fragment key={r.clientId}>
                  <tr style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="py-1.5 pr-3 font-medium whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{r.name}</td>
                    {r.cells.map((x, i) => (
                      <td key={i} className="p-1 text-center">
                        <button
                          type="button"
                          onClick={() => toggle(r.clientId)}
                          className="w-full h-8 rounded-md text-xs font-bold"
                          style={{ background: CELL[x.cell].bg, color: CELL[x.cell].fg }}
                          title={`${r.name} · week of ${weekLabel(data.grid.weeks[i])}: ${CELL[x.cell].label}`}
                          aria-label={`${r.name}, week of ${weekLabel(data.grid.weeks[i])}: ${CELL[x.cell].label}`}
                        >
                          {CELL_MARK[x.cell]}
                        </button>
                      </td>
                    ))}
                  </tr>
                  {open === r.clientId && (
                    <tr>
                      <td colSpan={9} className="pb-3">
                        <ClientCallsDropdown clientId={r.clientId} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-3 mt-3 text-[11px]" style={{ color: "var(--text-secondary)" }}>
            {(Object.keys(CELL) as WeekCell[]).map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span className="w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold" style={{ background: CELL[k].bg, color: CELL[k].fg }}>{CELL_MARK[k]}</span>
                {CELL[k].label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: number | string; sub?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="card rounded-2xl p-4">
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="font-heading text-2xl font-bold" style={{ color: tone === "bad" ? "var(--danger)" : tone === "warn" ? "var(--tag-amber-fg)" : "var(--text-primary)" }}>{value}</p>
      {sub && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{sub} of due</p>}
    </div>
  );
}

// Per account manager over the range, and calls held each week — one small
// chart per AM on a shared scale (a single hue; the table carries the exact
// numbers).
function Performance({ people }: { people: AmPerson[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...people.flatMap((p) => p.weekly.map((w) => w.held)));
  if (!people.length) return <p className="text-sm" style={{ color: "var(--text-muted)" }}>No calls in this range.</p>;
  return (
    <div className="space-y-5">
      <div className="card rounded-2xl p-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="text-left text-xs" style={{ color: "var(--text-muted)" }}>
              {["Account manager", "Clients", "Due", "Held", "Rescheduled", "Didn't happen", "Not logged", "On-time logging", "Avg days to log", "Clients at risk", "Updates emailed"].map((h) => (
                <th key={h} className="font-medium py-1.5 pr-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                <td className="py-2 pr-3 font-medium" style={{ color: "var(--text-primary)" }}>{p.name}</td>
                <td className="py-2 pr-3">{p.clients}</td>
                <td className="py-2 pr-3">{p.stats.due}</td>
                <td className="py-2 pr-3">{p.stats.held} <span className="text-xs" style={{ color: "var(--text-muted)" }}>{pct(p.stats.held, p.stats.due)}</span></td>
                <td className="py-2 pr-3">{p.stats.rescheduled}</td>
                <td className="py-2 pr-3">{p.stats.notHeld}</td>
                <td className="py-2 pr-3" style={{ color: p.stats.notLogged ? "var(--danger)" : undefined }}>{p.stats.notLogged}</td>
                <td className="py-2 pr-3">{p.stats.onTimePct == null ? "—" : `${p.stats.onTimePct}%`}</td>
                <td className="py-2 pr-3">{p.stats.avgDaysToLog ?? "—"}</td>
                <td className="py-2 pr-3" style={{ color: p.atRisk ? "var(--tag-amber-fg)" : undefined }}>{p.atRisk}</td>
                <td className="py-2 pr-3">{p.stats.emailed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card rounded-2xl p-5">
        <p className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>Calls held per week</p>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>{hover ?? "Hover a bar for the week's count."}</p>
        <div className="space-y-4">
          {people.map((p) => (
            <div key={p.id} className="grid grid-cols-[140px_1fr] items-end gap-3">
              <p className="text-xs font-medium truncate pb-1" style={{ color: "var(--text-secondary)" }}>{p.name}</p>
              <div className="flex items-end gap-[2px] h-16" style={{ borderBottom: "1px solid var(--border)" }} onMouseLeave={() => setHover(null)}>
                {p.weekly.map((w) => (
                  <div
                    key={w.week}
                    className="flex-1 h-full flex items-end"
                    onMouseEnter={() => setHover(`${p.name} · week of ${weekLabel(w.week)}: ${w.held} held`)}
                    title={`Week of ${weekLabel(w.week)}: ${w.held} held`}
                  >
                    <div className="w-full rounded-t" style={{ height: w.held ? `${(w.held / max) * 100}%` : 0, minHeight: w.held ? 3 : 0, background: "var(--primary)" }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {people[0]?.weekly.length > 0 && (
            <div className="grid grid-cols-[140px_1fr] gap-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span />
              <div className="flex justify-between">
                <span>{weekLabel(people[0].weekly[0].week)}</span>
                <span>{weekLabel(people[0].weekly[people[0].weekly.length - 1].week)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
