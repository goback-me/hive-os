import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getSheetValues } from "@/lib/google-sheets";
import { requireUser } from "@/lib/auth";

// Fetches live rows for a client's assigned sheet. Only visibleColumns are
// ever included in the response — hidden column data never leaves the
// server, even though the header NAME is known (for the column picker UI).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const scope = await requireUser();
  if (scope.role === "CLIENT" && clientId !== scope.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

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
    let resultStatusColumn = sheet.resultStatusColumn;
    if (JSON.stringify(liveHeaders) !== JSON.stringify(sheet.allColumns)) {
      visibleColumns = sheet.visibleColumns.filter((c) => liveHeaders.includes(c));
      if (visibleColumns.length === 0) visibleColumns = liveHeaders;
      statusColumn = statusColumn && visibleColumns.includes(statusColumn) ? statusColumn : null;
      resultStatusColumn = resultStatusColumn && visibleColumns.includes(resultStatusColumn) ? resultStatusColumn : null;
      await prisma.clientSheet.update({
        where: { clientId },
        data: { allColumns: liveHeaders, visibleColumns, statusColumn, resultStatusColumn },
      });
    }

    // Server-side filter: build the response using ONLY visible columns.
    const visibleIndexes = liveHeaders.map((h, i) => (visibleColumns.includes(h) ? i : -1)).filter((i) => i !== -1);
    const headers = visibleIndexes.map((i) => liveHeaders[i]);
    const rows = liveRows.map((r) => visibleIndexes.map((i) => r[i]));

    function valueCounts(column: string | null): { values: string[]; counts: Record<string, number> } | null {
      if (!column) return null;
      const colIdx = headers.indexOf(column);
      if (colIdx === -1) return null;
      const counts: Record<string, number> = {};
      for (const r of rows) {
        const v = r[colIdx];
        if (!v) continue;
        counts[v] = (counts[v] ?? 0) + 1;
      }
      return { values: Object.keys(counts).sort(), counts };
    }

    const statusStats = valueCounts(statusColumn);
    const resultStatusStats = valueCounts(resultStatusColumn);

    return NextResponse.json({
      headers,
      rows,
      statusColumn,
      statusValues: statusStats?.values ?? null,
      statusCounts: statusStats?.counts ?? null,
      resultStatusColumn,
      resultStatusValues: resultStatusStats?.values ?? null,
      resultStatusCounts: resultStatusStats?.counts ?? null,
      totalRows: rows.length,
    });
  } catch (err: any) {
    console.error("Fetch sheet data failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}