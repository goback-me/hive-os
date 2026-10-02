import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// "Update your leads" (components/ClientUpdatesPanel.tsx): leads the client
// owes us news on — handed over and waiting on Prospect Status, or sitting at
// booked / attended / quoted — oldest first.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const where = {
    clientId,
    deletedAt: null,
    OR: [{ awaitingClientUpdate: true }, { stage: { in: ["CONSULT_BOOKED", "CONSULT_ATTENDED", "QUOTE_SENT"] as ("CONSULT_BOOKED" | "CONSULT_ATTENDED" | "QUOTE_SENT")[] } }],
  };
  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
      select: { id: true, name: true, phone: true, email: true, campaign: true, stage: true, value: true, awaitingClientUpdate: true, createdAt: true },
    }),
  ]);
  return NextResponse.json({
    total,
    leads: leads.map((l) => ({ ...l, value: l.value == null ? null : Number(l.value), createdAt: l.createdAt.toISOString() })),
  });
}
