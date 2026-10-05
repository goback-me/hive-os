import { NextRequest, NextResponse } from "next/server";
import { requireUser, canAccessClient } from "@/lib/auth";
import { holdResponse } from "@/lib/report-hold";
import { getClientFunnel } from "@/lib/lead-sync";
import { getReportVisibility } from "@/lib/client-stats";
import { funnelForViewer } from "@/lib/funnel";
import { rangeFromParams } from "@/lib/date-range";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (!canAccessClient(user, clientId)) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }
  const hold = await holdResponse(user, clientId);
  if (hold) return hold;


  const [funnel, visibility] = await Promise.all([getClientFunnel(clientId, rangeFromParams(req.nextUrl.searchParams).range), getReportVisibility(clientId)]);
  return NextResponse.json(funnelForViewer(funnel, user.role, visibility));
}
