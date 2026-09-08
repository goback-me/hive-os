import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// Re-fetched by ProgressNotesPanel right after adding a note — the form
// itself is a client component now (see that file for why), so it needs its
// own way to pull the fresh list instead of relying on the server page
// re-rendering through ClientTabsShell.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const notes = await prisma.progressNote.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 10 });
  return NextResponse.json({
    notes: notes.map((n) => ({ id: n.id, note: n.note, createdBy: n.createdBy, createdAt: n.createdAt.toISOString() })),
  });
}
