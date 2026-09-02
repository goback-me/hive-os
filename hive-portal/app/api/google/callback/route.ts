import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto";
import { exchangeCodeForTokens, getGoogleUserEmail } from "@/lib/google-sheets";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/leads?error=${encodeURIComponent(error)}`, req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL(`/leads?error=missing_code`, req.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const email = await getGoogleUserEmail(tokens.access_token);

    // Singleton: replace whatever was connected before with this account.
    await prisma.googleAccountConnection.deleteMany({});
    await prisma.googleAccountConnection.create({
      data: {
        accessToken: encryptToken(tokens.access_token),
        refreshToken: encryptToken(tokens.refresh_token ?? ""),
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        googleEmail: email,
      },
    });

    return NextResponse.redirect(new URL(`/leads`, req.url));
  } catch (err: any) {
    console.error("Google OAuth callback failed:", err);
    return NextResponse.redirect(new URL(`/leads?error=${encodeURIComponent(err.message ?? "oauth_failed")}`, req.url));
  }
}
