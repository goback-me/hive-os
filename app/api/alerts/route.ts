import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// Data alerts for the bell / client banner: OPEN by default, DANGER first.
// Coaches / admins only.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "COACH" || user.isAgent) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const clientId = req.nextUrl.searchParams.get("clientId");
  const alerts = await prisma.dataAlert.findMany({
    where: { status: "OPEN", client: { archivedAt: null }, ...(clientId ? { clientId } : {}) },
    orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
    include: { client: { select: { name: true, slug: true } } },
    take: 200,
  });
  return NextResponse.json({ alerts: alerts.map(serializeAlert) });
}

function serializeAlert(a: Awaited<ReturnType<typeof prisma.dataAlert.findMany>>[number] & { client: { name: string; slug: string } }) {
  return {
    id: a.id,
    clientId: a.clientId,
    clientName: a.client.name,
    clientSlug: a.client.slug,
    type: a.type,
    severity: a.severity,
    title: a.title,
    detail: a.detail,
    fixHint: a.fixHint,
    fixUrl: a.fixUrl,
    count: a.count,
    status: a.status,
    firstSeenAt: a.firstSeenAt.toISOString(),
    lastSeenAt: a.lastSeenAt.toISOString(),
  };
}
