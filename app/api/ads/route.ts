import { NextRequest, NextResponse } from "next/server";
import { requireUser, canAccessClient } from "@/lib/auth";
import { holdResponse } from "@/lib/report-hold";
import { getReportVisibility } from "@/lib/client-stats";
import { getAdsReport } from "@/lib/campaign-report";
import { rangeFromParams } from "@/lib/date-range";

// Ads tab (components/AdsPanel.tsx): top cards + per-campaign table for the
// tab's date range ("Maximum" = start date → today), plus — for coaches —
// every campaign with its include/exclude tick. Spend and cost columns are
// left out for a CLIENT when cost metrics are hidden.
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
  return NextResponse.json(await getAdsReport(clientId, rangeFromParams(req.nextUrl.searchParams).range, user, visibility));
}
