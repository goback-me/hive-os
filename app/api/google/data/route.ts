import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getSheetValues } from "@/lib/google-sheets";
import { requireUser, canAccessClient } from "@/lib/auth";
import { findHeaderIndex, normalizeStatus } from "@/lib/sheet-parse";

// Fetches live rows for a client's assigned sheet. Only visibleColumns are
// ever included in the response — hidden column data never leaves the
// server, even though the header NAME is known (for the column picker UI).
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const scope = await requireUser();
  if (!canAccessClient(scope, clientId)) {
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
      // Visibility never affects the status columns. A header that only
      // changed spacing/case is re-pointed at its live spelling; a column is
      // only dropped when no header matches it even after normalizing.
      const relink = (name: string | null) => {
        const idx = findHeaderIndex(liveHeaders, name);
        return idx === -1 ? null : liveHeaders[idx];
      };
      statusColumn = relink(statusColumn);
      resultStatusColumn = relink(resultStatusColumn);
      await prisma.clientSheet.update({
        where: { clientId },
        data: { allColumns: liveHeaders, visibleColumns, statusColumn, resultStatusColumn },
      });
    }

    // Server-side filter: build the response using ONLY visible columns.
    const visibleIndexes = liveHeaders.map((h, i) => (visibleColumns.includes(h) ? i : -1)).filter((i) => i !== -1);
    const headers = visibleIndexes.map((i) => liveHeaders[i]);
    const rows = liveRows.map((r) => visibleIndexes.map((i) => r[i]));

    // Grouped by normalized value (the mapping key) — "DQ " and "dq" are one
    // entry. `labels` keeps the first raw spelling seen, for display.
    function valueCounts(column: string | null): { values: string[]; counts: Record<string, number>; labels: Record<string, string> } | null {
      if (!column) return null;
      // Read from the live sheet, not the visible subset — mapping works on
      // a status column even when it's hidden from the table.
      const colIdx = findHeaderIndex(liveHeaders, column);
      if (colIdx === -1) return null;
      const counts: Record<string, number> = {};
      const labels: Record<string, string> = {};
      for (const r of liveRows) {
        const v = normalizeStatus(r[colIdx]);
        if (!v) continue;
        counts[v] = (counts[v] ?? 0) + 1;
        labels[v] ??= r[colIdx].trim();
      }
      return { values: Object.keys(counts).sort(), counts, labels };
    }

    const statusStats = valueCounts(statusColumn);
    const resultStatusStats = valueCounts(resultStatusColumn);

    return NextResponse.json({
      headers,
      rows,
      statusColumn,
      statusValues: statusStats?.values ?? null,
      statusCounts: statusStats?.counts ?? null,
      statusLabels: statusStats?.labels ?? null,
      resultStatusColumn,
      resultStatusValues: resultStatusStats?.values ?? null,
      resultStatusCounts: resultStatusStats?.counts ?? null,
      resultStatusLabels: resultStatusStats?.labels ?? null,
      totalRows: rows.length,
    });
  } catch (err: any) {
    console.error("Fetch sheet data failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}