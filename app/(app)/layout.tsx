import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";
import Sidebar from "@/components/Sidebar";
import { VIEW_AS_COOKIE, getRealUser, requireUser } from "@/lib/auth";
import { stopViewAs } from "@/lib/actions";
import { prisma } from "@/lib/prisma";
import { ACTIVE_CLIENT } from "@/lib/am-calls";
import { LeadDrawerHost } from "@/components/LeadDetailDrawer";
import { CallPanelHost } from "@/components/CallUpdatePanel";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const user = await requireUser(); // redirects to /login if not signed in
  // Team: my calls past their time and not logged (Account Management badge).
  const callsToUpdate =
    user.role === "COACH" ? await prisma.amCall.count({ where: { status: "PENDING", scheduledAt: { lt: new Date() }, client: ACTIVE_CLIENT, callPerson: { clerkId: user.clerkId } } }) : 0;
  // Client: the tabs the team hid from them drop out of their sidebar too.
  const hiddenTabs =
    user.role === "CLIENT" && user.clientId ? (await prisma.client.findUnique({ where: { id: user.clientId }, select: { hiddenTabs: true } }))?.hiddenTabs ?? [] : [];
  // Admins: who they can preview the app as ("View as", lib/auth.ts).
  const real = await getRealUser();
  const viewAs = real?.isAdmin
    ? {
        current: cookies().get(VIEW_AS_COOKIE)?.value ?? "",
        clients: await prisma.client.findMany({ where: ACTIVE_CLIENT, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        team: await prisma.user.findMany({ where: { role: { in: ["COACH", "AGENT"] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
      }
    : null;

  return (
    <>
      <Suspense fallback={null}>
        <Sidebar user={{ name: user.name, role: user.role, isAgent: user.isAgent, clientSlug: user.clientSlug }} callsToUpdate={callsToUpdate} hiddenTabs={hiddenTabs} viewAs={viewAs} />
      </Suspense>
      <main className="ml-64 min-h-screen">
        {user.viewingAs && (
          <div className="sticky top-0 z-40 flex items-center justify-between gap-3 px-6 py-2.5 text-sm font-semibold" style={{ background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }}>
            <span>
              Viewing as {user.viewingAs}{user.role === "CLIENT" ? " (client)" : user.isAgent ? " (account manager)" : " (coach)"}: this is exactly what they see. Anything you change is saved as you.
            </span>
            <form action={stopViewAs}>
              <button type="submit" className="underline shrink-0">Exit preview</button>
            </form>
          </div>
        )}
        {children}
      </main>
      {/* Side panels on any page: ?lead=<id> (components/LeadLink.tsx) and
          ?update=<callId> (components/CallUpdatePanel.tsx). */}
      <Suspense fallback={null}>
        <LeadDrawerHost />
        {user.role === "COACH" && <CallPanelHost />}
      </Suspense>
    </>
  );
}