import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// Returns the cached column names (all of them, including hidden ones) so
// the column picker can render checkboxes — no row data here, just names.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const scope = await requireUser();
  if (scope.role === "CLIENT" && clientId !== scope.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const sheet = await prisma.clientSheet.findUnique({ where: { clientId } });
  if (!sheet) return NextResponse.json({ error: "No sheet assigned to this client yet" }, { status: 404 });

  return NextResponse.json({
    spreadsheetName: sheet.spreadsheetName,
    sheetName: sheet.sheetName,
    allColumns: sheet.allColumns,
    visibleColumns: sheet.visibleColumns,
    statusColumn: sheet.statusColumn,
    statusMapping: sheet.statusMapping ?? {},
    resultStatusColumn: sheet.resultStatusColumn,
    resultStatusMapping: sheet.resultStatusMapping ?? {},
  });
}
