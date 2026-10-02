import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { holdResponse } from "@/lib/report-hold";
import { getReportVisibility } from "@/lib/client-stats";
import { getSnapshot, isMonthKey } from "@/lib/kpi";

// Snapshot KPI cards for one Sydney month (?month=2026-09, default: current).
// For CLIENT users, hidden/zero/null cards are dropped server-side.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }
  const hold = await holdResponse(user, clientId);
  if (hold) return hold;

  const month = req.nextUrl.searchParams.get("month");
  const visibility = await getReportVisibility(clientId);
  return NextResponse.json(await getSnapshot(clientId, isMonthKey(month) ? month : null, user, visibility));
}
