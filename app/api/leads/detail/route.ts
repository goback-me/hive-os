import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, canAccessClient } from "@/lib/auth";
import { leadTimeline } from "@/lib/milestones";
import { noteAuthor, parseAliases } from "@/lib/notes-parser";
import { targetOptionsFor } from "@/lib/lead-status";

// Everything the lead drawer shows (components/LeadDetailDrawer.tsx), for any
// lead the viewer can see — a CLIENT only their own. The sheet's raw columns
// go to the team only; the stage options are the ones this viewer may set.
export async function GET(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("leadId");
  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      client: { select: { name: true, slug: true, noteAliases: true } },
      noteEvents: { orderBy: { at: "desc" } },
      stageEvents: { select: { id: true, stage: true, at: true, source: true } },
      notes: { orderBy: { createdAt: "desc" } },
      activity: { orderBy: { changedAt: "desc" } },
    },
  });
  if (!lead || lead.deletedAt) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const user = await requireUser();
  if (!canAccessClient(user, lead.clientId)) return NextResponse.json({ error: "Not authorized for this lead" }, { status: 403 });

  const aliases = parseAliases(lead.client.noteAliases);
  const isTeam = user.role === "COACH";
  return NextResponse.json({
    lead: {
      id: lead.id,
      clientId: lead.clientId,
      clientName: lead.client.name,
      clientSlug: lead.client.slug,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      campaign: lead.campaign,
      source: lead.source,
      createdAt: lead.createdAt.toISOString(),
      stage: lead.stage,
      dqReason: lead.dqReason,
      dqPhase: lead.dqPhase,
      lostReason: lead.lostReason,
      dqReasonEvidence: lead.dqReasonEvidence,
      callAttempts: lead.callAttempts,
      value: lead.value == null ? null : Number(lead.value),
      returnedCount: lead.returnedCount,
      sheetStatus: lead.sheetStatus,
      sheetWriteError: lead.sheetWriteError,
      raw: isTeam ? (lead.raw as Record<string, string> | null) : null,
    },
    timeline: leadTimeline(lead).map((s) => ({ ...s, at: s.at?.toISOString() ?? null })),
    sheetNotes: lead.noteEvents.map((n) => ({ id: n.id, at: n.at.toISOString(), who: noteAuthor(n.who, aliases), text: n.rawText, tag: n.event })),
    hqNotes: lead.notes.map((n) => ({ id: n.id, at: n.createdAt.toISOString(), who: n.createdBy, text: n.note })),
    changes: lead.activity.map((a) => ({ id: a.id, at: a.changedAt.toISOString(), who: a.changedBy, to: a.toStatus, value: a.value == null ? null : Number(a.value) })),
    stageOptions: targetOptionsFor(user.role),
  });
}
