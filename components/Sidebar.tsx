"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { SignOutButton } from "@clerk/nextjs";

const COACH_NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "space_dashboard" },
  { href: "/clients", label: "Clients", icon: "diversity_3" },
  { href: "/leads", label: "Leads", icon: "person_search" },
  { href: "/referrals", label: "Referrals", icon: "share" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export default function Sidebar({ user }: { user: { name: string; role: "COACH" | "CLIENT" } }) {
  const pathname = usePathname();
  // A client login only ever has their own client page — no cross-client
  // nav items are rendered for them at all, not just hidden via CSS.
  const navItems = user.role === "COACH" ? COACH_NAV_ITEMS : [];

  return (
    <aside
      className="fixed left-0 top-0 h-full w-64 flex flex-col py-6 px-4 z-50"
      style={{ background: "var(--surface-card)", borderRight: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3 px-2 mb-8">
        <img src="/logo.webp" alt="" width={36} height={36} className="w-9 h-9 shrink-0" />
        <h1 className="font-heading font-bold text-xl tracking-tight" style={{ color: "var(--text-primary)" }}>
          Hive HQ
        </h1>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-all"
              style={{
                color: active ? "var(--primary)" : "var(--text-secondary)",
                background: active ? "linear-gradient(90deg, var(--primary-tint), transparent)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = "linear-gradient(90deg, var(--primary-tint), transparent)";
                  e.currentTarget.style.color = "var(--primary)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }
              }}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ background: "var(--primary-tint)", color: "var(--primary)" }}
            >
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {user.name}
            </span>
          </div>
          <ThemeToggle />
        </div>
        <SignOutButton redirectUrl="/login">
          <button
            type="button"
            className="flex items-center gap-2 text-xs font-semibold w-full px-3 py-1"
            style={{ color: "var(--text-secondary)" }}
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            Sign out
          </button>
        </SignOutButton>
      </div>
    </aside>
  );
}