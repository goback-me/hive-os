import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Disconnects the single Hive Google account. Client sheet assignments
// (spreadsheet/tab/column choices) are left untouched — they'll just
// need the account reconnected before data can load again.
export async function POST() {
  await prisma.googleAccountConnection.deleteMany({});
  return NextResponse.json({ ok: true });
}
