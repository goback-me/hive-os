import { NextRequest, NextResponse } from "next/server";
import { requireUser, canAccessClient } from "@/lib/auth";
import { holdResponse } from "@/lib/report-hold";
import { getReportVisibility } from "@/lib/client-stats";
import { getSales } from "@/lib/sales";
import { previousReportRange, rangeFromParams } from "@/lib/date-range";

// Leads tab → Sales section (components/SalesPanel.tsx). Costs are left out
// for a CLIENT when cost metrics are hidden.
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
  const { range, report } = rangeFromParams(req.nextUrl.searchParams);
  return NextResponse.json(await getSales(clientId, range, user, visibility, previousReportRange(report)));
}
