import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth";
import AlertRow from "@/components/AlertRow";
import { alertLeads } from "@/lib/data-health";
import type { AlertStatus, DataAlertType } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUSES = ["OPEN", "RESOLVED", "DISMISSED", "ALL"] as const;
const TYPE_LABEL = (t: string) => t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ");

// Every data alert (lib/data-health.ts), filterable by client / type /
// status — RESOLVED and DISMISSED are the history. Coaches + admins only.
export default async function AlertsPage({ searchParams }: { searchParams: { client?: string; type?: string; status?: string } }) {
  await requireCoach();
  const status = (STATUSES as readonly string[]).includes(searchParams.status ?? "") ? searchParams.status! : "OPEN";
  const [clients, types] = await Promise.all([
    prisma.client.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.dataAlert.findMany({ distinct: ["type"], select: { type: true } }),
  ]);
  const alerts = await prisma.dataAlert.findMany({
    where: {
      client: { archivedAt: null },
      ...(searchParams.client ? { clientId: searchParams.client } : {}),
      ...(searchParams.type ? { type: searchParams.type as DataAlertType } : {}),
      ...(status !== "ALL" ? { status: status as AlertStatus } : {}),
    },
    orderBy: [{ status: "asc" }, { severity: "asc" }, { lastSeenAt: "desc" }],
    include: { client: { select: { name: true, slug: true } } },
    take: 500,
  });
  const leadsOf = await alertLeads(alerts);
  const selectStyle = { background: "var(--surface-card)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const when = (d: Date) => d.toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  return (
    <div className="p-10 max-w-[1100px] mx-auto">
      <h1 className="page-title font-heading" style={{ color: "var(--text-primary)" }}>Data alerts</h1>
      <p className="text-base mt-1 mb-6" style={{ color: "var(--text-secondary)" }}>Anything that would make a client&apos;s numbers wrong or stale. Re-checked after every sync; fixed problems resolve on their own.</p>

      <form className="flex flex-wrap gap-2 mb-6">
        <select name="client" defaultValue={searchParams.client ?? ""} className="px-3 py-2 rounded-lg text-sm" style={selectStyle} aria-label="Client">
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select name="type" defaultValue={searchParams.type ?? ""} className="px-3 py-2 rounded-lg text-sm" style={selectStyle} aria-label="Type">
          <option value="">All types</option>
          {types.map((t) => <option key={t.type} value={t.type}>{TYPE_LABEL(t.type)}</option>)}
        </select>
        <select name="status" defaultValue={status} className="px-3 py-2 rounded-lg text-sm" style={selectStyle} aria-label="Status">
          {STATUSES.map((s) => <option key={s} value={s}>{s === "ALL" ? "All statuses" : TYPE_LABEL(s)}</option>)}
        </select>
        <button className="btn-gradient px-4 py-2 rounded-lg text-sm font-bold">Filter</button>
      </form>

      <div className="card rounded-2xl px-5 py-2">
        {alerts.length === 0 && <p className="text-sm py-8 text-center" style={{ color: "var(--text-secondary)" }}>Nothing here.</p>}
        {alerts.map((a) => (
          <div key={a.id}>
            <AlertRow
              showClient
              alert={{ id: a.id, clientName: a.client.name, clientSlug: a.client.slug, severity: a.severity, title: a.title, detail: a.detail, fixHint: a.fixHint, fixUrl: a.fixUrl, status: a.status, lastSeenAt: a.lastSeenAt.toISOString(), dismissNote: a.dismissNote, ...leadsOf.get(a.id) }}
            />
            <p className="text-[10px] -mt-1 mb-2 pl-7" style={{ color: "var(--text-muted)" }}>
              {TYPE_LABEL(a.status)} · first seen {when(a.firstSeenAt)} · last seen {when(a.lastSeenAt)}
              {a.resolvedAt && ` · resolved ${when(a.resolvedAt)}`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
