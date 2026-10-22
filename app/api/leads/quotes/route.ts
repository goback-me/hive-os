import { NextRequest, NextResponse } from "next/server";
import { requireUser, canAccessClient } from "@/lib/auth";
import { holdResponse } from "@/lib/report-hold";
import { getQuotes } from "@/lib/quotes";
import { previousReportRange, rangeFromParams } from "@/lib/date-range";

// Leads tab → Quotes section, also on the Ads tab (components/QuotesPanel.tsx).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (!canAccessClient(user, clientId)) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }
  const hold = await holdResponse(user, clientId);
  if (hold) return hold;

  const { range, report } = rangeFromParams(req.nextUrl.searchParams);
  return NextResponse.json(await getQuotes(clientId, range, previousReportRange(report)));
}
