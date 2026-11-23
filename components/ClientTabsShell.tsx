"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

// The open tab is kept in the URL (?tab=leads) alongside the report range, so
// a refresh or a shared link lands on the same tab and period. A tab with
// onOpen runs it when opened, and its badge (e.g. "New") clears.
type Tab = { key: string; label: string; content: ReactNode; badge?: string; onOpen?: () => Promise<void> };
export default function ClientTabsShell({ tabs }: { tabs: Tab[] }) {
  const fromUrl = useSearchParams().get("tab");
  const [active, setActiveState] = useState(tabs.some((t) => t.key === fromUrl) ? fromUrl! : tabs[0]?.key);
  const [opened, setOpened] = useState<string[]>([]);
  // The sidebar links straight to a tab (?tab=leads) — follow it.
  useEffect(() => {
    if (fromUrl && fromUrl !== active && tabs.some((t) => t.key === fromUrl)) setActiveState(fromUrl);
  }, [fromUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const tab = tabs.find((t) => t.key === active);
    if (!tab?.onOpen || opened.includes(tab.key)) return;
    setOpened((o) => [...o, tab.key]);
    tab.onOpen().catch(() => {});
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  function setActive(key: string) {
    setActiveState(key);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", key);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }

  return (
    <div>
      <div className="flex gap-8 mb-8" style={{ borderBottom: "1px solid var(--border)" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className="pb-4 text-sm font-semibold transition-colors"
            style={{
              color: active === t.key ? "var(--primary)" : "var(--text-secondary)",
              borderBottom: active === t.key ? "3px solid var(--primary)" : "3px solid transparent",
            }}
            onMouseEnter={(e) => {
              if (active !== t.key) e.currentTarget.style.color = "var(--primary)";
            }}
            onMouseLeave={(e) => {
              if (active !== t.key) e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            {t.label}
            {t.badge && !(t.onOpen && opened.includes(t.key)) && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold align-middle" style={{ background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
      <div>{tabs.find((t) => t.key === active)?.content}</div>
    </div>
  );
}
