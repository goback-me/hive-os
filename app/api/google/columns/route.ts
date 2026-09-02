import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Saves which columns show, and (optionally) which visible column is the
// "status" column used for the filter dropdown. A status column that isn't
// in visibleColumns is rejected — hidden column data never leaves the server,
// so it can't power a filter either.
export async function POST(req: NextRequest) {
  const { clientId, visibleColumns, statusColumn } = await req.json();
  if (!clientId || !Array.isArray(visibleColumns)) {
    return NextResponse.json({ error: "clientId and visibleColumns[] are required" }, { status: 400 });
  }
  if (statusColumn && !visibleColumns.includes(statusColumn)) {
    return NextResponse.json({ error: "statusColumn must be one of the visible columns" }, { status: 400 });
  }

  await prisma.clientSheet.update({
    where: { clientId },
    data: { visibleColumns, statusColumn: statusColumn ?? null },
  });

  return NextResponse.json({ ok: true });
}
