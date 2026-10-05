import { NextRequest, NextResponse } from "next/server";
import { requireUser, canAccessClient } from "@/lib/auth";
import { holdResponse } from "@/lib/report-hold";
import { getLeadWins } from "@/lib/lead-wins";

// Leads tab headline cards + 60-day chart (components/LeadWinsCard.tsx).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (!canAccessClient(user, clientId)) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }
  const hold = await holdResponse(user, clientId);
  if (hold) return hold;

  const window = req.nextUrl.searchParams.get("window") === "last" ? "last" : "first";
  return NextResponse.json({ wins: await getLeadWins(clientId, window) });
}
