import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto";

// Saves a client's Meta ad account ID + access token. The token is encrypted
// before it touches Postgres — same AES-256-GCM scheme used for Google tokens.
export async function POST(req: NextRequest) {
  const { clientId, adAccountId, accessToken } = await req.json();
  if (!clientId || !adAccountId || !accessToken) {
    return NextResponse.json({ error: "clientId, adAccountId and accessToken are required" }, { status: 400 });
  }

  // normalize — Meta wants "act_123456", but people often paste just the digits
  const normalizedAccountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

  // Verify the token actually works before saving it, so a typo doesn't
  // silently sit in the DB looking "connected" but failing on every fetch.
  const check = await fetch(
    `https://graph.facebook.com/v21.0/${normalizedAccountId}?fields=name&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!check.ok) {
    const body = await check.json().catch(() => ({}));
    return NextResponse.json(
      { error: body?.error?.message ?? "Meta rejected that ad account ID / token combination" },
      { status: 400 }
    );
  }

  await prisma.client.update({
    where: { id: clientId },
    data: {
      metaAdAccountId: normalizedAccountId,
      metaAccessToken: encryptToken(accessToken),
    },
  });

  return NextResponse.json({ ok: true });
}