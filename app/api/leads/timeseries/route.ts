import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getClientLeadTimeSeries } from "@/lib/lead-sync";
import { rangeFromParams } from "@/lib/date-range";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }


  const points = await getClientLeadTimeSeries(clientId, rangeFromParams(req.nextUrl.searchParams).range);
  return NextResponse.json({ points });
}
