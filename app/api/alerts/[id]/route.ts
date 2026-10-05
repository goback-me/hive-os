import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// "Mark handled": a coach dismisses an alert with a note saying why. It stays
// quiet unless the problem grows (lib/data-health.ts).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (user?.role !== "COACH" || user.isAgent) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const { note } = await req.json().catch(() => ({ note: "" }));
  const text = String(note ?? "").trim();
  if (!text) return NextResponse.json({ error: "A note is required" }, { status: 400 });
  await prisma.dataAlert.update({ where: { id: params.id }, data: { status: "DISMISSED", dismissNote: `${text.slice(0, 500)} — ${user.name}` } });
  return NextResponse.json({ ok: true });
}
