import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { SLACK_OAUTH_STATE_COOKIE, slackRedirectUri } from "@/lib/slack";

// "Add to Slack" — installs the Hive bot into one workspace. Same CSRF
// `state` cookie pattern as app/api/google/connect.
export async function GET() {
  await requireAdmin();
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "SLACK_CLIENT_ID is not set. Add it to .env" }, { status: 500 });
  const state = randomBytes(32).toString("hex");
  const params = new URLSearchParams({
    client_id: clientId,
    // chat:write.public = can post to public channels without being invited.
    scope: "chat:write,chat:write.public",
    redirect_uri: slackRedirectUri(),
    state,
  });
  const res = NextResponse.redirect(`https://slack.com/oauth/v2/authorize?${params}`);
  res.cookies.set(SLACK_OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/slack" });
  return res;
}
