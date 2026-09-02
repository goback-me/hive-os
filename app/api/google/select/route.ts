import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getSheetValues } from "@/lib/google-sheets";

// Assigns a spreadsheet + tab to a client. This sticks until changed —
// upsert on clientId, so re-running it for the same client just updates it.
export async function POST(req: NextRequest) {
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

    return NextResponse.json({ ok: true, allColumns: sheet.allColumns, visibleColumns: sheet.visibleColumns });
  } catch (err: any) {
    console.error("Select sheet failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}
