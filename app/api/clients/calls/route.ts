import { NextRequest, NextResponse } from "next/server";
import { requireUser, canAccessClient } from "@/lib/auth";
import { getClientCallHistory } from "@/lib/am-calls";

// A client's call history for the shared dropdown (My Calls, Account
// Management). Team only — it carries internal notes and outcomes.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  const user = await requireUser();
  if (user.role !== "COACH" || !canAccessClient(user, clientId)) return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  return NextResponse.json(await getClientCallHistory(clientId));
}
