import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPortfolio } from "@/lib/portfolio";
import { parseReportRange } from "@/lib/date-range";

// Agency portfolio table on /dashboard — coaches / admins only.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "COACH" || user.isAgent) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  return NextResponse.json(await getPortfolio(parseReportRange(req.nextUrl.searchParams)));
}
