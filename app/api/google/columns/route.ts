import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCoach } from "@/lib/auth";
import { encodeTarget, parseTarget } from "@/lib/lead-status";
import { syncLeadsFromSheet } from "@/lib/lead-sync";
import { normalizeMappingKeys } from "@/lib/status-classifier";

// Saves which columns show, and (optionally) which column is the "status"
// column. The status/result columns don't have to be visible — mapping works
// independently of what the table shows. `statusMapping` (sheet value -> a
// funnel stage, optionally with a DQ/lost reason) feeds the sync
// (lib/lead-sync.ts); unmapped values fall back to the built-in defaults.
function validateMapping(mapping: unknown): string | null {
  if (!mapping || typeof mapping !== "object") return null;
  for (const v of Object.values(mapping)) {
    if (!parseTarget(v)) return `Invalid status mapping value: ${JSON.stringify(v)}`;
  }
  return null;
}

// Dropdown values ("DISQUALIFIED:BUDGET") → stored {stage, dqReason} objects,
// keyed by normalized sheet value.
function toStoredMapping(mapping: unknown) {
  return Object.fromEntries(
    Object.entries(normalizeMappingKeys<unknown>(mapping)).flatMap(([k, v]) => {
      const t = parseTarget(v);
      return t && encodeTarget(t) ? [[k, t]] : [];
    })
  );
}

// Write-back overrides: {status|result: {"WON": "SOLD"}} — stage targets that
// parse, string values only; anything else is dropped.
function toStoredWriteMapping(raw: unknown) {
  const out: Record<"status" | "result", Record<string, string>> = { status: {}, result: {} };
  for (const column of ["status", "result"] as const) {
    const m = (raw as Record<string, unknown>)?.[column];
    if (!m || typeof m !== "object") continue;
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      const t = parseTarget(k);
      if (t?.stage && typeof v === "string" && v.trim()) out[column][encodeTarget(t)] = v;
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  await requireCoach();
  const { clientId, visibleColumns, statusColumn, statusMapping, resultStatusColumn, resultStatusMapping, writeMapping } = await req.json();
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
      ...(statusMapping ? { statusMapping: toStoredMapping(statusMapping) } : {}),
      ...(resultStatusMapping ? { resultStatusMapping: toStoredMapping(resultStatusMapping) } : {}),
      ...(writeMapping ? { writeMapping: toStoredWriteMapping(writeMapping) } : {}),
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
