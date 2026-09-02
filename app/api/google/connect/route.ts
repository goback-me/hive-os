import { NextResponse } from "next/server";
import { getGoogleAuthUrl } from "@/lib/google-sheets";

// Connects the single Hive Google account (not per-client) — run this once.
export async function GET() {
  return NextResponse.redirect(getGoogleAuthUrl());
}
