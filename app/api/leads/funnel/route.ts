import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getClientFunnel } from "@/lib/lead-sync";
import { getReportVisibility } from "@/lib/client-stats";
import { funnelForViewer } from "@/lib/funnel";
import { rangeFromParams } from "@/lib/date-range";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }


  const [funnel, visibility] = await Promise.all([getClientFunnel(clientId, rangeFromParams(req.nextUrl.searchParams).range), getReportVisibility(clientId)]);
  return NextResponse.json(funnelForViewer(funnel, user.role, visibility));
}
