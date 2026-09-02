import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";

// Pulls spend/conversion data for a client's connected Meta ad account.
// Defaults to the last 30 days.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.metaAdAccountId || !client?.metaAccessToken) {
    return NextResponse.json({ error: "No Meta ad account connected for this client" }, { status: 400 });
  }

  try {
    const accessToken = decryptToken(client.metaAccessToken);
    const fields = "spend,impressions,clicks,cpm,ctr,actions,cost_per_action_type";
    const url =
      `https://graph.facebook.com/v21.0/${client.metaAdAccountId}/insights` +
      `?fields=${fields}&date_preset=last_30d&access_token=${encodeURIComponent(accessToken)}`;

    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message ?? "Meta API request failed");
    }

    const row = data.data?.[0] ?? null;
    if (!row) {
      return NextResponse.json({ spend: 0, impressions: 0, clicks: 0, cpm: 0, ctr: 0, conversions: 0, costPerConversion: null });
    }

    // "actions" is an array of {action_type, value} — conversions show up as
    // various action_types depending on what the campaign is optimizing for.
    // Sum anything that looks like a lead/purchase/conversion action.
    const conversionTypes = ["lead", "purchase", "complete_registration", "offsite_conversion.fb_pixel_lead"];
    const conversions = (row.actions ?? [])
      .filter((a: any) => conversionTypes.some((t) => a.action_type.includes(t)))
      .reduce((sum: number, a: any) => sum + Number(a.value), 0);

    const costPerConversionEntry = (row.cost_per_action_type ?? []).find((a: any) =>
      conversionTypes.some((t) => a.action_type.includes(t))
    );

    return NextResponse.json({
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      cpm: Number(row.cpm ?? 0),
      ctr: Number(row.ctr ?? 0),
      conversions,
      costPerConversion: costPerConversionEntry ? Number(costPerConversionEntry.value) : null,
    });
  } catch (err: any) {
    console.error("Meta insights fetch failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}