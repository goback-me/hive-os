import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getLeadWins } from "@/lib/lead-wins";

// Leads tab headline cards + 60-day chart (components/LeadWinsCard.tsx).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const window = req.nextUrl.searchParams.get("window") === "last" ? "last" : "first";
  return NextResponse.json({ wins: await getLeadWins(clientId, window) });
}
