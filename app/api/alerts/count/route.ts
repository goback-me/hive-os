import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// The sidebar bell's badge (components/AlertBell.tsx), polled every 60s.
// Coaches / admins only — clients never see data alerts.
export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "COACH") return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const where = { status: "OPEN" as const, client: { archivedAt: null } };
  const [open, danger] = await Promise.all([prisma.dataAlert.count({ where }), prisma.dataAlert.count({ where: { ...where, severity: "DANGER" } })]);
  return NextResponse.json({ open, danger });
}
