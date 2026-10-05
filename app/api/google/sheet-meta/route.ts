import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, canAccessClient } from "@/lib/auth";
import { parseMapping } from "@/lib/status-classifier";
import { TARGET_OPTIONS, encodeTarget, parseTarget, type LeadStageValue, type StageTarget } from "@/lib/lead-status";
import { planStageWrite } from "@/lib/sheet-writeback";
import { DATE_OPT_IN_KEYWORDS, findColumn } from "@/lib/sheet-parse";

// Returns the cached column names (all of them, including hidden ones) so
// the column picker can render checkboxes — no row data here, just names.
const encodeAll = (m: Record<string, StageTarget>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, encodeTarget(v)]));

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const scope = await requireUser();
  if (!canAccessClient(scope, clientId)) {
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
    statusMapping: encodeAll(parseMapping(sheet.statusMapping)),
    resultStatusColumn: sheet.resultStatusColumn,
    resultStatusMapping: encodeAll(parseMapping(sheet.resultStatusMapping)),
    unmappedStatuses: sheet.unmappedStatuses ?? { status: {}, result: {} },
    hasOptInDateColumn: findColumn(sheet.allColumns, DATE_OPT_IN_KEYWORDS) !== -1,
    // Write-back: which column + value each stage writes when changed in HQ
    // (automatic choice, before the coach's overrides), and the overrides.
    statusOptions: sheet.statusOptions,
    resultStatusOptions: sheet.resultStatusOptions,
    writeMapping: sheet.writeMapping ?? { status: {}, result: {} },
    writePlan: TARGET_OPTIONS.map((o) => {
      const t = parseTarget(o.value) as StageTarget & { stage: LeadStageValue };
      const plan = planStageWrite(t, null, { ...sheet, writeMapping: null });
      const column = "error" in plan ? null : plan.column === sheet.statusColumn ? "status" : "result";
      return { target: o.value, label: o.label, column, auto: "error" in plan ? null : plan.value };
    }),
  });
}
