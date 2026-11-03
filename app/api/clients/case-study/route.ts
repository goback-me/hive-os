import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth";
import { caseStudyCsv, getCaseStudyRows } from "@/lib/case-study";

// Coach-only CSV of a client's month-by-month results for case studies
// (lib/case-study.ts) — works after Meta is disconnected, from the saved history.
export async function GET(req: NextRequest) {
  await requireCoach();
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { slug: true } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const csv = caseStudyCsv(await getCaseStudyRows(clientId));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${client.slug}-case-study.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
