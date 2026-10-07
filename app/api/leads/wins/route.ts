import { NextRequest, NextResponse } from "next/server";
import { requireUser, canAccessClient } from "@/lib/auth";
import { holdResponse } from "@/lib/report-hold";
import { getLeadWins } from "@/lib/lead-wins";
import { rangeFromParams } from "@/lib/date-range";

// Leads tab headline cards + daily chart for the tab's date range (components/LeadWinsCard.tsx).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (!canAccessClient(user, clientId)) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }
  const hold = await holdResponse(user, clientId);
  if (hold) return hold;

  return NextResponse.json({ wins: await getLeadWins(clientId, rangeFromParams(req.nextUrl.searchParams).range) });
}
