import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { REMINDER_DAYS } from "@/lib/reminders";

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
  // Leads with a 7-day reminder out (lib/reminders.ts) are the client's tasks
  // — listed first.
  const reminded = new Map(
    (
      await prisma.leadReminder.findMany({
        where: { leadId: { in: leads.map((l) => l.id) }, createdAt: { gt: new Date(Date.now() - REMINDER_DAYS * 86_400_000) } },
        select: { leadId: true, createdAt: true },
      })
    ).map((r) => [r.leadId, r.createdAt.toISOString()])
  );
  const rows = leads.map((l) => ({ ...l, value: l.value == null ? null : Number(l.value), createdAt: l.createdAt.toISOString(), remindedAt: reminded.get(l.id) ?? null }));
  rows.sort((a, b) => Number(!!b.remindedAt) - Number(!!a.remindedAt));
  return NextResponse.json({ total, reminders: reminded.size, leads: rows });
}
