"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { setUrlParam } from "@/lib/url-param";

// Opening a lead = adding ?lead=<id> to the current URL; LeadDrawerHost
// (components/LeadDetailDrawer.tsx) shows the drawer for it. The URL can be
// shared, and Back closes the drawer. Everything else in the URL (tab, date
// range) stays as it is.
export const setLeadParam = (id: string | null) => setUrlParam("lead", id);

export const useOpenLead = () => setLeadParam;

// A lead's name (or any content) that opens its drawer. A real link, so
// ctrl/cmd-click opens it in a new tab.
export default function LeadLink({ id, children, className, style }: { id: string; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  const pathname = usePathname();
  const sp = new URLSearchParams(useSearchParams().toString());
  sp.set("lead", id);
  return (
    <a
      href={`${pathname}?${sp.toString()}`}
      className={className ?? "hover:underline"}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        setLeadParam(id);
      }}
    >
      {children}
    </a>
  );
}
