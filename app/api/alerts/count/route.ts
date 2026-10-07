import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// The sidebar bell (components/AlertBell.tsx), polled every 60s: the
// viewer's calls 24h+ past and still not updated (lib/am-calls.ts), and — for
// coaches / admins — open data alerts. Clients never see either.
export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "COACH") return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const where = { status: "OPEN" as const, client: { archivedAt: null } };
  const [open, danger, calls] = await Promise.all([
    user.isAgent ? 0 : prisma.dataAlert.count({ where }),
    user.isAgent ? 0 : prisma.dataAlert.count({ where: { ...where, severity: "DANGER" } }),
    prisma.amCall.findMany({
      where: { status: "PENDING", scheduledAt: { lte: new Date(Date.now() - 24 * 3_600_000) }, callPerson: { clerkId: user.clerkId } },
      orderBy: { scheduledAt: "asc" },
      take: 20,
      select: { id: true, scheduledAt: true, client: { select: { name: true } } },
    }),
  ]);
  return NextResponse.json({ open, danger, calls: calls.map((c) => ({ id: c.id, clientName: c.client.name, scheduledAt: c.scheduledAt.toISOString() })) });
}
