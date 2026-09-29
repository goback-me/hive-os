"use client";

import { useEffect, useRef, useState } from "react";
import { WIN_WINDOW_DAYS, type LeadWins, type WinsDay, type WinsWindow } from "@/lib/lead-wins";

const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const shortDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });

// Leads tab headline: won-lead revenue over the client's first (or last) 60
// days, and a daily chart of leads coming in vs deals closing.
export default function LeadWinsCard({ clientId, reloadKey }: { clientId: string; reloadKey: number }) {
  const [win, setWin] = useState<WinsWindow>("first");
  const [data, setData] = useState<LeadWins | null | undefined>(undefined); // undefined = loading, null = no leads yet
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<WinsDay | null>(null);
  const req = useRef(0);

  useEffect(() => {
    const id = ++req.current;
    setError(null);
    fetch(`/api/leads/wins?clientId=${clientId}&window=${win}`)
      .then((r) => r.json())
      .then((res) => {
        if (id !== req.current) return;
        if (res.error) throw new Error(res.error);
        setData(res.wins);
      })
      .catch((e) => id === req.current && setError(e.message));
  }, [clientId, win, reloadKey]);

  if (error) return <p className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>;
  if (data === null) return null;
  if (data === undefined) {
    return (
      <div className="grid grid-cols-2 gap-4">
        <span className="skeleton h-[106px] rounded-2xl" />
        <span className="skeleton h-[106px] rounded-2xl" />
      </div>
    );
  }

  const days = data.days;
  const maxWin = Math.max(...days.map((d) => d.wins.reduce((a, b) => a + b, 0)), 1);
  const maxLeads = Math.max(...days.map((d) => d.leads), 1);
  const running = days.length < WIN_WINDOW_DAYS;
  const range = days.length ? `${shortDate(days[0].date)} – ${shortDate(days[days.length - 1].date)}` : "";

  return (
    <div className="space-y-4 fade-in">
      <div className="grid grid-cols-2 gap-4">
        <Card icon="payments" label="Revenue closed" sub={`${data.won} job${data.won === 1 ? "" : "s"} won · ${data.leads} leads`} value={money(data.revenue)} />
        <Card icon="schedule" label="Time frame" sub={range} value={running ? `${days.length} of ${WIN_WINDOW_DAYS} days` : `${WIN_WINDOW_DAYS} days`} />
      </div>

      <div className="card rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: "var(--surface-hover)" }}>
            {(["first", "last"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWin(w)}
                className="px-3 py-1.5 rounded-md text-xs font-bold"
                style={win === w ? { background: "var(--surface-card)", color: "var(--text-primary)" } : { color: "var(--text-secondary)" }}
              >
                {w === "first" ? "First 60 days" : "Last 60 days"}
              </button>
            ))}
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {hover
              ? `${shortDate(hover.date)} · ${hover.leads} lead${hover.leads === 1 ? "" : "s"} in${hover.wins.length ? ` · closed ${hover.wins.map(money).join(" + ")}` : ""}`
              : "Hover a day"}
          </p>
        </div>

        <div className="flex items-end gap-[3px] h-28" onMouseLeave={() => setHover(null)}>
          {days.map((d) => {
            const won = d.wins.reduce((a, b) => a + b, 0);
            return (
              <div key={d.date} className="flex-1 h-full flex flex-col justify-end" onMouseEnter={() => setHover(d)}>
                <div
                  className="w-full rounded-t"
                  style={{
                    height: d.wins.length ? `${Math.max(18, (won / maxWin) * 100)}%` : d.leads ? `${Math.max(6, (d.leads / maxLeads) * 14)}%` : "3%",
                    background: d.wins.length ? "var(--primary)" : d.leads ? "var(--text-muted)" : "var(--surface-hover)",
                    outline: hover?.date === d.date ? "2px solid var(--text-primary)" : "none",
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] mt-1.5" style={{ color: "var(--text-muted)" }}>
          <span>{days[0] && shortDate(days[0].date)}</span>
          <span>{days.length > 2 && shortDate(days[Math.floor(days.length / 2)].date)}</span>
          <span>{days.length > 1 && shortDate(days[days.length - 1].date)}</span>
        </div>
        <div className="flex gap-4 text-xs mt-3" style={{ color: "var(--text-secondary)" }}>
          <Legend color="var(--primary)" label="Deal closed" />
          <Legend color="var(--text-muted)" label="Lead came in" />
        </div>
        {data.won === 0 && (
          <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>No deals marked Won in this window yet.</p>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function Card({ icon, label, sub, value }: { icon: string; label: string; sub: string; value: string }) {
  return (
    <div className="card rounded-2xl p-5">
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{sub}</p>
        </div>
        <span className="icon-chip w-8 h-8" style={{ background: "var(--primary-tint)" }}>
          <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--primary)" }}>{icon}</span>
        </span>
      </div>
      <p key={value} className="font-heading font-bold text-2xl fade-in" style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}
