import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// Lazy-loaded only when a lead's detail popup is open (components/LeadsPanel.tsx)
// — keeps the paginated lead list itself light. Adding a note goes through
// the addLeadNote server action, not this route — this is read-only.
export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("leadId");
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clientId: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const user = await requireUser();
  if (user.role === "CLIENT" && lead.clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const notes = await prisma.leadNote.findMany({ where: { leadId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    notes: notes.map((n) => ({
      id: n.id,
      note: n.note,
      createdBy: n.createdBy,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}
