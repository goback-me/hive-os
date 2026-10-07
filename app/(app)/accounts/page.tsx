import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth";
import { MOOD_LABELS, WEEKDAY_LABELS } from "@/lib/weekly-meetings";

export const dynamic = "force-dynamic";

const WEEKS = 4;
const sydDate = (d: Date) => d.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short" });

// Account managers and their clients' weekly calls (lib/weekly-meetings.ts):
// the last few calls per client, so admins can see who logs their calls.
// Coaches + admins only (middleware keeps clients and agents out).
export default async function AccountsPage() {
  await requireCoach();
  const since = new Date(Date.now() - WEEKS * 7 * 86_400_000);
  const clients = await prisma.client.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      weeklyCallDay: true,
      weeklyCallAgent: { select: { id: true, name: true } },
      meetings: { where: { weekOf: { gte: since } }, orderBy: { weekOf: "desc" }, select: { id: true, weekOf: true, status: true, clientMood: true, nextMeetingAt: true } },
    },
  });

  // One group per account manager; clients without one go last.
  const groups = new Map<string, { name: string; clients: typeof clients }>();
  for (const c of clients) {
    const key = c.weeklyCallAgent?.id ?? "";
    if (!groups.has(key)) groups.set(key, { name: c.weeklyCallAgent?.name ?? "No account manager", clients: [] });
    groups.get(key)!.clients.push(c);
  }
  const ordered = Array.from(groups.entries()).sort(([a, x], [b, y]) => (a ? (b ? x.name.localeCompare(y.name) : -1) : 1));

  const chip = (s: "PENDING" | "HELD" | "NOT_HELD") =>
    s === "HELD"
      ? { label: "Held", style: { background: "var(--tag-green-bg)", color: "var(--tag-green-fg)" } }
      : s === "NOT_HELD"
      ? { label: "Didn't happen", style: { background: "var(--danger-tint)", color: "var(--danger)" } }
      : { label: "Not logged", style: { background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" } };

  return (
    <div className="p-10 max-w-[1100px] mx-auto">
      <h1 className="page-title font-heading" style={{ color: "var(--text-primary)" }}>Accounts</h1>
      <p className="text-base mt-1 mb-6" style={{ color: "var(--text-secondary)" }}>Each account manager&apos;s clients and their weekly calls over the last {WEEKS} weeks.</p>

      <div className="space-y-5">
        {ordered.map(([key, g]) => {
          const calls = g.clients.flatMap((c) => c.meetings);
          const held = calls.filter((m) => m.status === "HELD").length;
          const missed = calls.filter((m) => m.status === "NOT_HELD").length;
          const unlogged = calls.filter((m) => m.status === "PENDING").length;
          return (
            <div key={key || "none"} className="card rounded-2xl p-5">
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {g.name} <span className="font-normal" style={{ color: "var(--text-muted)" }}>· {g.clients.length} client{g.clients.length === 1 ? "" : "s"}</span>
                </p>
                {key && (
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {held} held · {missed} didn&apos;t happen · <span style={{ color: unlogged ? "var(--danger)" : undefined }}>{unlogged} not logged</span>
                  </p>
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs" style={{ color: "var(--text-muted)" }}>
                    <th className="font-medium py-1">Client</th>
                    <th className="font-medium py-1">Call day</th>
                    <th className="font-medium py-1">Recent calls</th>
                    <th className="font-medium py-1">Last outcome</th>
                    <th className="font-medium py-1">Next call</th>
                  </tr>
                </thead>
                <tbody>
                  {g.clients.map((c) => {
                    const lastHeld = c.meetings.find((m) => m.status === "HELD");
                    return (
                      <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td className="py-2">
                          <Link href={`/clients/${c.slug}`} className="font-medium" style={{ color: "var(--text-primary)" }}>{c.name}</Link>
                        </td>
                        <td className="py-2" style={{ color: "var(--text-secondary)" }}>{key ? WEEKDAY_LABELS[c.weeklyCallDay] : "—"}</td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-1">
                            {c.meetings.length ? (
                              c.meetings.map((m) => (
                                <Link key={m.id} href={`/clients/${c.slug}/calls/${m.id}`} title={sydDate(m.weekOf)} className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={chip(m.status).style}>
                                  {sydDate(m.weekOf).replace(/^\w+ /, "")} · {chip(m.status).label}
                                </Link>
                              ))
                            ) : (
                              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{key ? "No calls yet" : "Pick an account manager on the client page"}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2" style={{ color: lastHeld?.clientMood === "AT_RISK" ? "var(--danger)" : "var(--text-secondary)" }}>
                          {lastHeld?.clientMood ? MOOD_LABELS[lastHeld.clientMood] : "—"}
                        </td>
                        <td className="py-2" style={{ color: "var(--text-secondary)" }}>{lastHeld?.nextMeetingAt ? sydDate(lastHeld.nextMeetingAt) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
        {!clients.length && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No clients yet.</p>}
      </div>
    </div>
  );
}
