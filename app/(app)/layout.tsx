import { Suspense, type ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LeadDrawerHost } from "@/components/LeadDetailDrawer";
import { CallPanelHost } from "@/components/CallUpdatePanel";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const user = await requireUser(); // redirects to /login if not signed in
  // Team: my calls past their time and not logged (My Calls badge).
  const callsToUpdate =
    user.role === "COACH" ? await prisma.amCall.count({ where: { status: "PENDING", scheduledAt: { lt: new Date() }, callPerson: { clerkId: user.clerkId } } }) : 0;

  return (
    <>
      <Suspense fallback={null}>
        <Sidebar user={{ name: user.name, role: user.role, isAgent: user.isAgent, clientSlug: user.clientSlug }} callsToUpdate={callsToUpdate} />
      </Suspense>
      <main className="ml-64 min-h-screen">{children}</main>
      {/* Side panels on any page: ?lead=<id> (components/LeadLink.tsx) and
          ?update=<callId> (components/CallUpdatePanel.tsx). */}
      <Suspense fallback={null}>
        <LeadDrawerHost />
        {user.role === "COACH" && <CallPanelHost />}
      </Suspense>
    </>
  );
}