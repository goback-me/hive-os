import { NextResponse } from "next/server";
import { getValidAccessToken, listSpreadsheets } from "@/lib/google-sheets";

export async function GET() {
  try {
    const accessToken = await getValidAccessToken();
    const files = await listSpreadsheets(accessToken);
    return NextResponse.json({ files });
  } catch (err: any) {
    console.error("List spreadsheets failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}
