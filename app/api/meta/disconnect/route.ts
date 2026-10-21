import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth";
import { archiveMetaInsights } from "@/lib/meta-archive";

export async function POST(req: NextRequest) {
  await requireCoach();
  const { clientId } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  // Last top-up of the case-study archive while we still have the token.
  // The archived rows (MetaAdInsight) stay after disconnect. A dead token
  // must not block disconnecting.
  await archiveMetaInsights(clientId).catch((err) => console.error("Meta archive failed:", err));

  await prisma.client.update({
    where: { id: clientId },
    data: { metaAdAccountId: null, metaAccessToken: null },
  });

  return NextResponse.json({ ok: true });
}
