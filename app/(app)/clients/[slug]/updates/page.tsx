import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAccessClient, requireUser } from "@/lib/auth";
import { verifyActionToken } from "@/lib/action-token";
import { recordEmailClick } from "@/lib/email";
import { updateLeadStage } from "@/lib/actions";
import ClientUpdatesPanel from "@/components/ClientUpdatesPanel";
import Forbidden from "@/components/Forbidden";

export const dynamic = "force-dynamic";

// Where the "update your leads" emails land (lib/reminders.ts). ?a= is the
// email's signed token: it isn't a login (middleware already made them sign
// in) — it only says which leads to pin at the top, and records the click.
export default async function UpdatesPage({ params, searchParams }: { params: { slug: string }; searchParams: { a?: string } }) {
  const user = await requireUser();
  const client = await prisma.client.findUnique({ where: { slug: params.slug }, select: { id: true, name: true, slug: true } });
  if (!client) notFound();
  if (!canAccessClient(user, client.id)) return <Forbidden />;

  const token = verifyActionToken(searchParams.a);
  const fromEmail = token?.clientId === client.id ? token : null;
  if (fromEmail) await recordEmailClick(searchParams.a);

  return (
    <div className="p-10 max-w-[1100px] mx-auto space-y-5">
      <div>
        <Link href={`/clients/${client.slug}?tab=dashboard`} className="text-xs font-semibold" style={{ color: "var(--primary)" }}>
          ← {client.name}
        </Link>
        <h1 className="font-heading text-3xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>Update your leads</h1>
        <p style={{ color: "var(--text-secondary)" }}>Tell us what happened with each lead. Every change updates your sheet too.</p>
      </div>
      <ClientUpdatesPanel
        clientId={client.id}
        onUpdateStage={updateLeadStage}
        pinnedIds={fromEmail?.refIds ?? []}
        keepSaved
        emptyText="All caught up — no leads are waiting on your update."
      />
    </div>
  );
}
