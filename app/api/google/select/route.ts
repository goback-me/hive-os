import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getSheetValues } from "@/lib/google-sheets";
import { clearClientLeads, syncLeadsFromSheet } from "@/lib/lead-sync";
import { requireCoach } from "@/lib/auth";

// Assigns a spreadsheet + tab to a client (one sheet per client). Picking a
// DIFFERENT sheet/tab than before wipes the old sheet's leads and column
// settings first, so two sheets never mix. Then syncs straight away and
// reports the result — a failed sync is returned, never swallowed.
export async function POST(req: NextRequest) {
  await requireCoach();
  const { clientId, spreadsheetId, spreadsheetName, sheetName } = await req.json();
  if (!clientId || !spreadsheetId || !sheetName) {
    return NextResponse.json({ error: "clientId, spreadsheetId and sheetName are required" }, { status: 400 });
  }

  try {
    const accessToken = await getValidAccessToken();
    const { headers } = await getSheetValues(accessToken, spreadsheetId, sheetName);

    const previous = await prisma.clientSheet.findUnique({ where: { clientId } });
    const sheetChanged = previous && (previous.spreadsheetId !== spreadsheetId || previous.sheetName !== sheetName);
    if (sheetChanged) await clearClientLeads(clientId);

    const fresh = {
      spreadsheetId,
      spreadsheetName: spreadsheetName ?? null,
      sheetName,
      allColumns: headers,
      visibleColumns: headers, // default: show every column, narrow it down after
    };
    await prisma.clientSheet.upsert({
      where: { clientId },
      create: { clientId, ...fresh },
      // Same sheet re-picked → keep its status settings; new sheet → reset them.
      update: sheetChanged
        ? { ...fresh, statusColumn: null, statusMapping: Prisma.DbNull, resultStatusColumn: null, resultStatusMapping: Prisma.DbNull, lastSyncedAt: null, lastSyncError: null }
        : fresh,
    });

    try {
      const summary = await syncLeadsFromSheet(clientId);
      return NextResponse.json({ ok: true, synced: summary.created + summary.updated });
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
