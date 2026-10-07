import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { rangeFromParams } from "@/lib/date-range";
import { amScope } from "@/lib/am-scope";
import { clientsCsv, getAccountManagement } from "@/lib/account-management";

// Account Management → Export: the client table as CSV, same scope and range
// as the page. Team only.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "COACH") return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const scope = await amScope(user, req.nextUrl.searchParams.get("am"));
  const data = await getAccountManagement({ am: scope.am, clientIds: scope.clientIds, range: rangeFromParams(req.nextUrl.searchParams).range });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
  return new NextResponse(clientsCsv(data.clients), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="account-management-${day}.csv"` },
  });
}
