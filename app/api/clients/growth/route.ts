import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getReportVisibility } from "@/lib/client-stats";
import { getGrowth } from "@/lib/growth";
import { rangeFromParams } from "@/lib/date-range";

// Growth tab (components/GrowthPanel.tsx). Cost metrics are left out for a
// CLIENT when the coach hides them.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const visibility = await getReportVisibility(clientId);
  return NextResponse.json(await getGrowth(clientId, rangeFromParams(req.nextUrl.searchParams).range, user, visibility));
}
