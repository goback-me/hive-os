import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getSheetValues } from "@/lib/google-sheets";

// Fetches live rows for a client's assigned sheet. Only visibleColumns are
// ever included in the response — hidden column data never leaves the
// server, even though the header NAME is known (for the column picker UI).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const sheet = await prisma.clientSheet.findUnique({ where: { clientId } });
  if (!sheet) {
    return NextResponse.json({ error: "No sheet assigned to this client yet" }, { status: 400 });
  }

  try {
    const accessToken = await getValidAccessToken();
    const { headers: liveHeaders, rows: liveRows } = await getSheetValues(
      accessToken,
      sheet.spreadsheetId,
      sheet.sheetName
    );

    // Keep the cached column list fresh if the sheet's headers changed —
    // this never affects what THIS response sends, only future picker loads.
    let visibleColumns = sheet.visibleColumns;
    let statusColumn = sheet.statusColumn;
    if (JSON.stringify(liveHeaders) !== JSON.stringify(sheet.allColumns)) {
      visibleColumns = sheet.visibleColumns.filter((c) => liveHeaders.includes(c));
      if (visibleColumns.length === 0) visibleColumns = liveHeaders;
      statusColumn = statusColumn && visibleColumns.includes(statusColumn) ? statusColumn : null;
      await prisma.clientSheet.update({
        where: { clientId },
        data: { allColumns: liveHeaders, visibleColumns, statusColumn },
      });
    }

    // Server-side filter: build the response using ONLY visible columns.
    const visibleIndexes = liveHeaders.map((h, i) => (visibleColumns.includes(h) ? i : -1)).filter((i) => i !== -1);
    const headers = visibleIndexes.map((i) => liveHeaders[i]);
    const rows = liveRows.map((r) => visibleIndexes.map((i) => r[i]));

    let statusValues: string[] | null = null;
    let statusCounts: Record<string, number> | null = null;
    if (statusColumn) {
      const colIdx = headers.indexOf(statusColumn);
      if (colIdx !== -1) {
        statusCounts = {};
        for (const r of rows) {
          const v = r[colIdx];
          if (!v) continue;
          statusCounts[v] = (statusCounts[v] ?? 0) + 1;
        }
        statusValues = Object.keys(statusCounts).sort();
      }
    }

    return NextResponse.json({ headers, rows, statusColumn, statusValues, statusCounts, totalRows: rows.length });
  } catch (err: any) {
    console.error("Fetch sheet data failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}