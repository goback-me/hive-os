import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth";
import { LEAD_STATUSES } from "@/lib/lead-status";
import { normalizeMappingKeys, syncLeadsFromSheet } from "@/lib/lead-sync";

// Saves which columns show, and (optionally) which column is the "status"
// column. The status/result columns don't have to be visible — mapping works
// independently of what the table shows. `statusMapping` (sheet value -> one of
// our 6 lead statuses) feeds the Leads tab's sync (lib/lead-sync.ts) — it's
// independent of visibleColumns/the raw-table filter above.
function validateMapping(mapping: unknown): string | null {
  if (!mapping || typeof mapping !== "object") return null;
  for (const v of Object.values(mapping)) {
    if (!LEAD_STATUSES.includes(v as never)) return `Invalid status mapping value: ${v}`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  await requireCoach();
  const { clientId, visibleColumns, statusColumn, statusMapping, resultStatusColumn, resultStatusMapping } = await req.json();
  if (!clientId || !Array.isArray(visibleColumns)) {
    return NextResponse.json({ error: "clientId and visibleColumns[] are required" }, { status: 400 });
  }
  const statusMappingError = validateMapping(statusMapping);
  if (statusMappingError) return NextResponse.json({ error: statusMappingError }, { status: 400 });
  const resultStatusMappingError = validateMapping(resultStatusMapping);
  if (resultStatusMappingError) return NextResponse.json({ error: resultStatusMappingError }, { status: 400 });

  await prisma.clientSheet.update({
    where: { clientId },
    data: {
      visibleColumns,
      statusColumn: statusColumn ?? null,
      resultStatusColumn: resultStatusColumn ?? null,
      ...(statusMapping ? { statusMapping: normalizeMappingKeys<string>(statusMapping) } : {}),
      ...(resultStatusMapping ? { resultStatusMapping: normalizeMappingKeys<string>(resultStatusMapping) } : {}),
    },
  });

  // Re-sync so new status mappings show on the client's Leads tab right away.
  try {
    await syncLeadsFromSheet(clientId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: true, syncError: err.message ?? "Sync failed" });
  }
}
