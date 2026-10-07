import { Suspense, type ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import { requireUser } from "@/lib/auth";
import { LeadDrawerHost } from "@/components/LeadDetailDrawer";
import { CallPanelHost } from "@/components/CallUpdatePanel";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const user = await requireUser(); // redirects to /login if not signed in

  return (
    <>
      <Sidebar user={{ name: user.name, role: user.role, isAgent: user.isAgent }} />
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