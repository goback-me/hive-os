import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId") || undefined;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [client, leads, spendRows, revenueRows] = await Promise.all([
    clientId ? prisma.client.findUnique({ where: { id: clientId } }) : null,
    prisma.lead.findMany({
      where: { createdAt: { gte: monthStart }, ...(clientId ? { clientId } : {}) },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.adSpendDaily.findMany({
      where: { date: { gte: monthStart }, ...(clientId ? { clientId } : {}) },
      orderBy: { date: "asc" },
    }),
    prisma.revenueMonthly.findMany({
      where: { month: monthStart, ...(clientId ? { clientId } : {}) },
      include: { client: { select: { name: true } } },
    }),
  ]);

  const rangeLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const lines: string[] = [];
  lines.push(`Hive OS report — ${client ? client.name : "All clients"} — ${rangeLabel}`);
  lines.push("");
  lines.push("Revenue");
  lines.push("Client,Amount");
  for (const r of revenueRows) lines.push(`${r.client?.name ?? "Agency"},${Number(r.amount)}`);
  lines.push("");
  lines.push("Ad spend");
  lines.push("Date,Amount");
  for (const s of spendRows) lines.push(`${s.date.toISOString().slice(0, 10)},${Number(s.spend)}`);
  lines.push("");
  lines.push("Leads");
  lines.push("Date,Client,Source,Status,Value");
  for (const l of leads) {
    lines.push(
      `${l.createdAt.toISOString().slice(0, 10)},${l.client.name},${l.source ?? ""},${l.status},${l.value ? Number(l.value) : ""}`
    );
  }

  const csv = lines.join("\n");

  await prisma.generatedReport.create({
    data: { clientId: clientId ?? null, rangeLabel, format: "csv" },
  });

  const filename = `hive-os-report-${client ? client.slug : "all-clients"}-${now.toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
