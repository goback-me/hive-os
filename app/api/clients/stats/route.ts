import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getClientStats, getReportVisibility, statsForViewer } from "@/lib/client-stats";
import { rangeFromParams } from "@/lib/date-range";

// Client Dashboard cards + the Leads tab's Profit / ROI section, for a date
// range. Hidden fields are stripped for CLIENT users (statsForViewer).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const { range, allTime } = rangeFromParams(req.nextUrl.searchParams);
  const [stats, visibility] = await Promise.all([getClientStats(clientId, range, allTime), getReportVisibility(clientId)]);
  return NextResponse.json(statsForViewer(stats, user.role, visibility));
}
