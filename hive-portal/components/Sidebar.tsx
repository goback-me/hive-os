"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/clients", label: "Clients", icon: "groups" },
  { href: "/leads", label: "Leads", icon: "contact_page" },
  { href: "/referrals", label: "Referrals", icon: "handshake" },
  { href: "/reports", label: "Reports", icon: "analytics" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 flex flex-col py-lg px-md bg-surface border-r border-outline-variant z-50">
      <div className="mb-xl flex items-center gap-sm px-sm">
        <div className="w-10 h-10 bg-primary-container rounded-lg flex items-center justify-center">
          <span className="material-symbols-outlined text-white">hive</span>
        </div>
        <div>
          <h1 className="font-headline-md text-headline-sm font-bold text-primary leading-none">Hive OS</h1>
          <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mt-1">
            Agency Command
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "flex items-center gap-md px-md py-3 rounded-lg transition-colors font-label-md " +
                (active
                  ? "bg-primary-container/10 text-primary border-l-4 border-primary font-bold"
                  : "text-on-surface-variant hover:bg-surface-container")
              }
            >
              <span
                className="material-symbols-outlined"
                style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="pt-lg border-t border-outline-variant">
        <Link
          href="/settings"
          className="flex items-center gap-md px-md py-3 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-primary-container/10 flex items-center justify-center text-[12px] font-bold text-primary">
            A
          </div>
          <span className="font-label-md">Adeel</span>
        </Link>
      </div>
    </aside>
  );
}
