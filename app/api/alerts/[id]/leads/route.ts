import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { getSheetTabIds, getValidAccessToken } from "@/lib/google-sheets";

// A lead alert's Fix panel (components/AlertLeadsFix.tsx): the affected leads
// with what each needs, plus a link to each lead's sheet row for the alerts
// fixed in the sheet itself. Coaches / admins only, like the alerts.
const SHEET_FIXES = ["LEAD_NO_CAMPAIGN", "BAD_OPTIN_DATE"];

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (user?.role !== "COACH" || user.isAgent) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const alert = await prisma.dataAlert.findUnique({ where: { id: params.id }, select: { type: true, clientId: true, affectedLeadIds: true } });
  if (!alert) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

  const [leads, sheet] = await Promise.all([
    prisma.lead.findMany({
      where: { id: { in: alert.affectedLeadIds }, deletedAt: null },
      select: { id: true, name: true, phone: true, email: true, stage: true, value: true, sheetWriteError: true, sheetTab: true, sheetRow: true, awaitingClientUpdate: true, handoverAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.clientSheet.findUnique({ where: { clientId: alert.clientId }, select: { spreadsheetId: true } }),
  ]);

  // Row links only where the fix is in the sheet (one Google call).
  const gids = SHEET_FIXES.includes(alert.type) && sheet ? await getValidAccessToken().then((t) => getSheetTabIds(t, sheet.spreadsheetId)).catch(() => new Map<string, number>()) : new Map<string, number>();
  const rowUrl = (tab: string | null, row: number | null) => {
    if (!sheet) return null;
    const base = `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit`;
    const gid = tab ? gids.get(tab) : undefined;
    return gid === undefined ? base : `${base}#gid=${gid}${row ? `&range=A${row}` : ""}`;
  };

  return NextResponse.json({
    type: alert.type,
    leads: leads.map((l) => ({
      id: l.id,
      name: l.name || l.phone || l.email || "Unnamed lead",
      stage: l.stage,
      sheetWriteError: l.sheetWriteError,
      sheetRow: l.sheetRow,
      sheetTab: l.sheetTab,
      rowUrl: SHEET_FIXES.includes(alert.type) ? rowUrl(l.sheetTab, l.sheetRow) : null,
      handoverAt: l.handoverAt?.toISOString() ?? null,
    })),
  });
}
