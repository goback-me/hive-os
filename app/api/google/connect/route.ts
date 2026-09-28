import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getGoogleAuthUrl, GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google-sheets";
import { requireCoach } from "@/lib/auth";

// Connects the single Hive Google account (not per-client) — run this once.
// `state` is a CSRF guard: the callback only accepts a code whose state
// matches this cookie.
export async function GET() {
  await requireCoach();
  const state = randomBytes(32).toString("hex");
  const res = NextResponse.redirect(getGoogleAuthUrl(state));
  res.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true, // browsers treat localhost as secure, so dev still works
    sameSite: "lax",
    maxAge: 600,
    path: "/api/google",
  });
  return res;
}
