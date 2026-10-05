import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto";
import { requireAdmin } from "@/lib/auth";
import { SLACK_OAUTH_STATE_COOKIE, slackRedirectUri } from "@/lib/slack";

// Built from the public URL, not the request Host (see app/api/google/callback).
const APP_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

function back(error?: string) {
  const res = NextResponse.redirect(new URL(error ? `/settings?slack_error=${encodeURIComponent(error)}` : "/settings", APP_URL));
  res.cookies.delete({ name: SLACK_OAUTH_STATE_COOKIE, path: "/api/slack" });
  return res;
}

export async function GET(req: NextRequest) {
  await requireAdmin();
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get(SLACK_OAUTH_STATE_COOKIE)?.value;

  if (!state || !expected || state !== expected) return back("invalid_state");
  if (error) return back(error);
  if (!code) return back("missing_code");

  try {
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.SLACK_CLIENT_ID ?? "",
        client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
        redirect_uri: slackRedirectUri(),
      }),
    });
    const data = await res.json();
    if (!data.ok || !data.access_token) return back(data.error ?? "oauth_failed");

    const fields = { slackBotToken: encryptToken(data.access_token), slackTeamName: data.team?.name ?? null };
    await prisma.integrationSettings.upsert({ where: { id: "singleton" }, update: fields, create: { id: "singleton", ...fields } });
    return back();
  } catch (err: any) {
    console.error("Slack OAuth callback failed:", err);
    return back(err.message ?? "oauth_failed");
  }
}
