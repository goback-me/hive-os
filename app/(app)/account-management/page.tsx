import { prisma } from "@/lib/prisma";
import { requireTeam } from "@/lib/auth";
import { parseReportRange, rangeFromParams } from "@/lib/date-range";
import { amScope } from "@/lib/am-scope";
import { getAccountManagement } from "@/lib/account-management";
import AccountManagement from "@/components/AccountManagement";

export const dynamic = "force-dynamic";

// Account Management: every client's calls and health for the selected
// account manager and date range (MTD default) — the client table (rows
// expand inline), AM performance (admins) and the 8-week grid.
export default async function AccountManagementPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const user = await requireTeam();
  const sp = new URLSearchParams(Object.entries(searchParams).filter((e): e is [string, string] => typeof e[1] === "string"));
  const scope = await amScope(user, sp.get("am"));
  const [data, team, firstCall] = await Promise.all([
    getAccountManagement({ am: scope.am, clientIds: scope.clientIds, range: rangeFromParams(sp).range }),
    scope.canPick ? prisma.user.findMany({ where: { role: { in: ["ADMIN", "COACH", "AGENT"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    prisma.amCall.findFirst({ orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true } }),
  ]);
  const view = sp.get("view") === "performance" && user.isAdmin ? "performance" : sp.get("view") === "grid" ? "grid" : "clients";
  return (
    <AccountManagement
      data={data}
      range={parseReportRange(sp)}
      maxFrom={firstCall ? new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(firstCall.scheduledAt) : null}
      am={scope.canPick ? { value: scope.value, team } : null}
      view={view}
      showPerformance={user.isAdmin}
    />
  );
}
