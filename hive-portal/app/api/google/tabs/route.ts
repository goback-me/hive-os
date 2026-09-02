import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, listSheetTabs } from "@/lib/google-sheets";

export async function GET(req: NextRequest) {
  const spreadsheetId = req.nextUrl.searchParams.get("spreadsheetId");
  if (!spreadsheetId) return NextResponse.json({ error: "spreadsheetId is required" }, { status: 400 });

  try {
    const accessToken = await getValidAccessToken();
    const tabs = await listSheetTabs(accessToken, spreadsheetId);
    return NextResponse.json({ tabs });
  } catch (err: any) {
    console.error("List tabs failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}
