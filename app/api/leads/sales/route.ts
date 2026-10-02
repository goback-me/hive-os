import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getReportVisibility } from "@/lib/client-stats";
import { getSales } from "@/lib/sales";
import { DATE_RANGE_PRESETS, resolveDateRange, type DateRangePreset } from "@/lib/date-range";

// Leads tab → Sales section (components/SalesPanel.tsx). Costs are left out
// for a CLIENT when cost metrics are hidden.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const presetParam = req.nextUrl.searchParams.get("range");
  const preset: DateRangePreset = DATE_RANGE_PRESETS.includes(presetParam as DateRangePreset) ? (presetParam as DateRangePreset) : "maximum";
  const visibility = await getReportVisibility(clientId);
  return NextResponse.json(await getSales(clientId, resolveDateRange(preset), user, visibility));
}
