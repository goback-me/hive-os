import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { deleteSheetRow, getAdminGoogleConnection, getSheetTabId, getSheetValues, getValidAccessToken, hasWriteScope } from "@/lib/google-sheets";
import { findColumn, normalizeEmail, normalizeName, normalizePhone } from "@/lib/sheet-parse";
import { syncLeadsFromSheet } from "@/lib/lead-sync";
import type { DuplicateRow } from "@/lib/reconcile";

// The "Sheet and HQ don't match" alert's Fix panel (components/DuplicateRowsFix.tsx):
// GET  the duplicate rows from the latest sync, with links into the sheet
// POST { sync: true }          sync now and re-check
// POST { row, name, email, phone }  delete that sheet row — only if it still
//      holds that lead (rows shift when the sheet is edited) — then sync.
// Coaches / admins only.

async function load(alertId: string) {
  const alert = await prisma.dataAlert.findUnique({ where: { id: alertId }, select: { clientId: true } });
  if (!alert) return null;
  const [sheet, latest] = await Promise.all([
    prisma.clientSheet.findUnique({ where: { clientId: alert.clientId } }),
    prisma.syncReconciliation.findFirst({ where: { clientId: alert.clientId }, orderBy: { createdAt: "desc" } }),
  ]);
  return { clientId: alert.clientId, sheet, latest };
}

async function state(alertId: string) {
  const d = await load(alertId);
  if (!d?.sheet) return null;
  const tabId = await getValidAccessToken()
    .then((t) => getSheetTabId(t, d.sheet!.spreadsheetId, d.sheet!.sheetName))
    .catch(() => null);
  return {
    ok: !!d.latest?.ok,
    // null = synced before duplicates were recorded — a sync lists them
    duplicates: (d.latest?.sheetCounts as { duplicates?: DuplicateRow[] } | null)?.duplicates ?? null,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${d.sheet.spreadsheetId}/edit${tabId != null ? `#gid=${tabId}` : ""}`,
    canDelete: hasWriteScope(await getAdminGoogleConnection()) && tabId != null,
  };
}

async function coach() {
  const user = await getCurrentUser();
  return user?.role === "COACH" && !user.isAgent;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await coach())) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const s = await state(params.id);
  return s ? NextResponse.json(s) : NextResponse.json({ error: "No sheet for this alert" }, { status: 404 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await coach())) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { sync?: boolean; row?: number; name?: string; email?: string; phone?: string };
  const d = await load(params.id);
  if (!d?.sheet) return NextResponse.json({ error: "No sheet for this alert" }, { status: 404 });

  try {
    if (!body.sync) {
      const row = Number(body.row);
      if (!Number.isInteger(row) || row < 2) return NextResponse.json({ error: "Bad row" }, { status: 400 });
      if (!hasWriteScope(await getAdminGoogleConnection())) return NextResponse.json({ error: "Google needs reconnecting with write access (Leads page)" }, { status: 400 });
      const token = await getValidAccessToken();
      const tabId = await getSheetTabId(token, d.sheet.spreadsheetId, d.sheet.sheetName);
      if (tabId == null) return NextResponse.json({ error: `Tab "${d.sheet.sheetName}" not found in the sheet` }, { status: 400 });

      // The row must still be this lead — the sheet may have changed since the sync.
      const { headers, rows } = await getSheetValues(token, d.sheet.spreadsheetId, d.sheet.sheetName);
      const cells = rows[row - 2] ?? [];
      const cell = (idx: number) => (idx === -1 ? "" : cells[idx] ?? "");
      const nameIdx = findColumn(headers, ["name", "full name"], ["campaign", "ad", "adset", "ad set", "business"]);
      const same =
        normalizeName(cell(nameIdx)) === normalizeName(body.name) &&
        normalizeEmail(cell(findColumn(headers, ["email"]))) === normalizeEmail(body.email) &&
        normalizePhone(cell(findColumn(headers, ["phone"]))) === normalizePhone(body.phone);
      if (!same) return NextResponse.json({ error: `Row ${row} has changed since the last sync — press "Sync & re-check", then try again.` }, { status: 409 });

      await deleteSheetRow(token, d.sheet.spreadsheetId, tabId, row);
    }
    await syncLeadsFromSheet(d.clientId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 300) : "Failed" }, { status: 500 });
  }
  return NextResponse.json(await state(params.id));
}
