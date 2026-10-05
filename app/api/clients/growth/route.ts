import { NextRequest, NextResponse } from "next/server";
import { requireUser, canAccessClient } from "@/lib/auth";
import { holdResponse } from "@/lib/report-hold";
import { getReportVisibility } from "@/lib/client-stats";
import { getGrowth } from "@/lib/growth";
import { rangeFromParams } from "@/lib/date-range";

// Growth tab (components/GrowthPanel.tsx). Cost metrics are left out for a
// CLIENT when the coach hides them.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (!canAccessClient(user, clientId)) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }
  const hold = await holdResponse(user, clientId);
  if (hold) return hold;

  const visibility = await getReportVisibility(clientId);
  return NextResponse.json(await getGrowth(clientId, rangeFromParams(req.nextUrl.searchParams).range, user, visibility));
}
