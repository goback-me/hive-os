import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getSheetValues } from "@/lib/google-sheets";
import { syncLeadsFromSheet } from "@/lib/lead-sync";
import { requireCoach } from "@/lib/auth";

// Assigns a spreadsheet + tab to a client. This sticks until changed —
// upsert on clientId, so re-running it for the same client just updates it.
export async function POST(req: NextRequest) {
  await requireCoach();
  const { clientId, spreadsheetId, spreadsheetName, sheetName } = await req.json();
  if (!clientId || !spreadsheetId || !sheetName) {
    return NextResponse.json({ error: "clientId, spreadsheetId and sheetName are required" }, { status: 400 });
  }

  try {
    const accessToken = await getValidAccessToken();
    const { headers } = await getSheetValues(accessToken, spreadsheetId, sheetName);

    const sheet = await prisma.clientSheet.upsert({
      where: { clientId },
      create: {
        clientId,
        spreadsheetId,
        spreadsheetName: spreadsheetName ?? null,
        sheetName,
        allColumns: headers,
        visibleColumns: headers, // default: show every column, narrow it down after
      },
      update: {
        spreadsheetId,
        spreadsheetName: spreadsheetName ?? null,
        sheetName,
        allColumns: headers,
        visibleColumns: headers,
        statusColumn: null, // reset — old status column may not exist in the new sheet
      },
    });

    // Populate the Leads tab immediately instead of leaving it at "0 leads"
    // until someone happens to click "Sync now" — a sync failure here (rare;
    // read access was already proven above) shouldn't block the assignment
    // itself, so it's swallowed rather than turning this into a 500.
    try {
      await syncLeadsFromSheet(clientId);
    } catch (syncErr) {
      console.error("Initial lead sync after connecting sheet failed:", syncErr);
    }

    return NextResponse.json({ ok: true, allColumns: sheet.allColumns, visibleColumns: sheet.visibleColumns });
  } catch (err: any) {
    console.error("Select sheet failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}
