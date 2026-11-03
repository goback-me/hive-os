import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken } from "@/lib/google-sheets";
import { clearClientLeads, syncLeadsFromSheet } from "@/lib/lead-sync";
import { getCombinedSheetValues, sheetTabs } from "@/lib/sheet-tabs";
import { requireCoach } from "@/lib/auth";

// Assigns a spreadsheet + one or more of its tabs to a client (one sheet per
// client; several tabs are synced as one list — lib/sheet-tabs.ts). The first
// tab is the primary one. A DIFFERENT spreadsheet, or a tab set with nothing
// in common with the old one, wipes the old leads and column settings first,
// so two sheets never mix. Adding a tab keeps everything; removing one
// soft-deletes only that tab's leads. Then syncs straight away and reports
// the result — a failed sync is returned, never swallowed.
export async function POST(req: NextRequest) {
  await requireCoach();
  const body = await req.json();
  const { clientId, spreadsheetId, spreadsheetName } = body;
  const requested: unknown[] = Array.isArray(body.sheetNames) ? body.sheetNames : body.sheetName ? [body.sheetName] : [];
  const tabs = Array.from(new Set(requested.filter((t): t is string => typeof t === "string" && t.length > 0)));
  if (!clientId || !spreadsheetId || !tabs.length) {
    return NextResponse.json({ error: "clientId, spreadsheetId and at least one tab are required" }, { status: 400 });
  }

  try {
    const accessToken = await getValidAccessToken();
    const { headers } = await getCombinedSheetValues(accessToken, spreadsheetId, tabs);

    const previous = await prisma.clientSheet.findUnique({ where: { clientId } });
    const oldTabs = previous ? sheetTabs(previous) : [];
    const sheetChanged = !!previous && (previous.spreadsheetId !== spreadsheetId || !oldTabs.some((t) => tabs.includes(t)));
    if (sheetChanged) {
      await clearClientLeads(clientId);
    } else if (previous) {
      // Tabs taken off: their leads go (restored if the tab is added back).
      // Leads synced before tabs were recorded (sheetTab null) came from the
      // old primary tab.
      const removed = oldTabs.filter((t) => !tabs.includes(t));
      if (removed.length) {
        await prisma.lead.updateMany({
          where: {
            clientId,
            deletedAt: null,
            externalKey: { not: null },
            OR: [{ sheetTab: { in: removed } }, ...(removed.includes(previous.sheetName) ? [{ sheetTab: null }] : [])],
          },
          data: { deletedAt: new Date() },
        });
      }
    }

    const fresh = {
      spreadsheetId,
      spreadsheetName: spreadsheetName ?? null,
      sheetName: tabs[0],
      sheetNames: tabs.length > 1 ? tabs : [],
      allColumns: headers,
    };
    // A brand-new column list shows every column; re-picking keeps the
    // coach's choice, plus any column a newly added tab brings.
    const added = previous ? headers.filter((h) => !previous.allColumns.includes(h)) : headers;
    const visibleColumns = !previous || sheetChanged ? headers : [...previous.visibleColumns.filter((c) => headers.includes(c)), ...added];
    await prisma.clientSheet.upsert({
      where: { clientId },
      create: { clientId, ...fresh, visibleColumns: headers },
      // Same sheet re-picked → keep its status settings; new sheet → reset them.
      update: sheetChanged
        ? { ...fresh, visibleColumns, statusColumn: null, statusMapping: Prisma.DbNull, resultStatusColumn: null, resultStatusMapping: Prisma.DbNull, lastSyncedAt: null, lastSyncError: null }
        : { ...fresh, visibleColumns },
    });

    try {
      const summary = await syncLeadsFromSheet(clientId);
      return NextResponse.json({ ok: true, synced: summary.leads });
    } catch (syncErr: any) {
      return NextResponse.json({ ok: true, syncError: syncErr.message ?? "Sync failed" });
    }
  } catch (err: any) {
    console.error("Select sheet failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}

// Removes a client's sheet assignment and the leads that came from it.
export async function DELETE(req: NextRequest) {
  await requireCoach();
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  await clearClientLeads(clientId);
  await prisma.clientSheet.deleteMany({ where: { clientId } });
  return NextResponse.json({ ok: true });
}
