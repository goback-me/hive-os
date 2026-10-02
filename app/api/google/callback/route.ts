import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto";
import { requireAdmin } from "@/lib/auth";
import { exchangeCodeForTokens, getGoogleUserEmail, GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google-sheets";

// Build redirects from the known public URL, not the incoming request's
// Host header — behind Traefik that header isn't always what you'd expect,
// and a wrong Host here means users get bounced to "localhost:3000".
const APP_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

function redirectWithError(error: string) {
  const res = NextResponse.redirect(new URL(`/leads?error=${encodeURIComponent(error)}`, APP_URL));
  res.cookies.delete({ name: GOOGLE_OAUTH_STATE_COOKIE, path: "/api/google" });
  return res;
}

export async function GET(req: NextRequest) {
  await requireAdmin();

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;

  if (!state || !expectedState || state !== expectedState) return redirectWithError("invalid_state");
  if (error) return redirectWithError(error);
  if (!code) return redirectWithError("missing_code");

  try {
    const tokens = await exchangeCodeForTokens(code);
    const email = await getGoogleUserEmail(tokens.access_token);

    // Google only sometimes returns a refresh_token — keep the existing one
    // rather than overwriting it with "" (which would break every future refresh).
    const existing = await prisma.googleAccountConnection.findFirst({ orderBy: { connectedAt: "desc" } });
    const refreshToken = tokens.refresh_token ? encryptToken(tokens.refresh_token) : existing?.refreshToken;
    if (!refreshToken) return redirectWithError("Google did not return a refresh token — remove the app's access in your Google account settings and connect again");

    // Singleton: replace whatever was connected before with this account.
    await prisma.$transaction([
      prisma.googleAccountConnection.deleteMany({}),
      prisma.googleAccountConnection.create({
        data: {
          accessToken: encryptToken(tokens.access_token),
          refreshToken,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          googleEmail: email,
        },
      }),
    ]);

    const res = NextResponse.redirect(new URL(`/leads`, APP_URL));
    res.cookies.delete({ name: GOOGLE_OAUTH_STATE_COOKIE, path: "/api/google" });
    return res;
  } catch (err: any) {
    console.error("Google OAuth callback failed:", err);
    return redirectWithError(err.message ?? "oauth_failed");
  }
}
