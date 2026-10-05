import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, canAccessClient } from "@/lib/auth";
import { noteAuthor, parseAliases } from "@/lib/notes-parser";

// Lazy-loaded only when a lead's "Details" row is expanded (components/LeadsPanel.tsx)
// — keeps the paginated lead list itself light.
export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("leadId");
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clientId: true, deletedAt: true, client: { select: { noteAliases: true } } } });
  if (!lead || lead.deletedAt) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const user = await requireUser();
  if (!canAccessClient(user, lead.clientId)) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  // Real changes (who/value) come from the audit log; imported, inferred and
  // returned stages only exist as events, so those are returned separately.
  // Sheet = the feedback cell's dated entries (read-only — HQ notes never go
  // back to the sheet).
  const [activity, events, sheet] = await Promise.all([
    prisma.leadActivity.findMany({ where: { leadId }, orderBy: { changedAt: "desc" } }),
    prisma.leadStageEvent.findMany({ where: { leadId, source: { in: ["IMPORT", "INFERRED", "RETURNED_BY_CLIENT"] } }, orderBy: { at: "desc" } }),
    prisma.leadNoteEvent.findMany({ where: { leadId }, orderBy: { at: "desc" } }),
  ]);
  const aliases = parseAliases(lead.client.noteAliases);
  return NextResponse.json({
    events: events.map((e) => ({ id: e.id, stage: e.stage, source: e.source, at: e.at.toISOString() })),
    sheet: sheet.map((n) => ({ id: n.id, at: n.at.toISOString(), who: noteAuthor(n.who, aliases), text: n.rawText, tag: n.event })),
    activity: activity.map((a) => ({
      id: a.id,
      fromStatus: a.fromStatus,
      toStatus: a.toStatus,
      value: a.value ? Number(a.value) : null,
      changedBy: a.changedBy,
      changedAt: a.changedAt.toISOString(),
    })),
  });
}
