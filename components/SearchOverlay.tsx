"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

type ClientOption = { id: string; name: string; slug: string };

const SHORTCUTS = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Clients", href: "/clients", icon: "groups" },
  { label: "Referrals", href: "/referrals", icon: "handshake" },
  { label: "Reports", href: "/reports", icon: "analytics" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

export default function SearchOverlay({ clients }: { clients: ClientOption[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const q = query.trim().toLowerCase();
  const matchedClients = q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients.slice(0, 5);
  const matchedShortcuts = q ? SHORTCUTS.filter((s) => s.label.toLowerCase().includes(q)) : SHORTCUTS;

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "flex",
          width: "100%",
          maxWidth: 448,
          alignItems: "center",
          gap: 8,
          flexWrap: "nowrap",
          position: "relative",
        }}
        className="bg-surface-container-low border border-outline-variant rounded-xl pl-10 pr-4 py-1.5 text-body-sm text-on-surface-variant text-left"
      >
        <span
          className="material-symbols-outlined text-outline text-[20px]"
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
        >
          search
        </span>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Search clients, tasks, or reports...
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4, flexShrink: 0, opacity: 0.6 }}>
          <span className="text-[10px] font-bold border border-outline px-1 rounded">⌘</span>
          <span className="text-[10px] font-bold border border-outline px-1 rounded">K</span>
        </span>
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-50 modal-overlay flex items-start justify-center pt-[102px]" onClick={() => setOpen(false)}>
          <div
            style={{ width: "100%", maxWidth: 672 }}
            className="bg-surface rounded-2xl shadow-2xl overflow-hidden border border-outline-variant"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-lg border-b border-outline-variant bg-surface-container-low flex items-center gap-md">
              <span className="material-symbols-outlined text-primary text-2xl">search</span>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients or jump to a page..."
                style={{ flexGrow: 1 }}
                className="bg-transparent border-none outline-none font-headline-sm text-headline-sm text-on-surface placeholder-outline"
              />
              <button
                onClick={() => setOpen(false)}
                className="bg-surface-variant/50 text-on-surface-variant font-label-sm px-md py-sm rounded-lg hover:bg-surface-variant transition-colors"
              >
                ESC
              </button>
            </div>

            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {matchedClients.length > 0 && (
                <div className="px-lg pt-lg pb-md">
                  <h4 className="font-label-sm text-outline uppercase tracking-widest mb-md">Clients</h4>
                  <div className="space-y-1">
                    {matchedClients.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => go(`/clients/${c.slug}`)}
                        style={{ width: "100%" }}
                        className="group flex items-center justify-between p-md rounded-xl hover:bg-primary/5 transition-all border border-transparent hover:border-primary/10 text-left"
                      >
                        <div className="flex items-center gap-md">
                          <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-primary font-bold text-sm">
                            {c.name.slice(0, 2).toUpperCase()}
                          </div>
                          <p className="font-label-md text-on-surface group-hover:text-primary">{c.name}</p>
                        </div>
                        <span className="material-symbols-outlined text-outline group-hover:text-primary text-[18px]">
                          arrow_forward_ios
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {matchedShortcuts.length > 0 && (
                <div className="px-lg pt-sm pb-lg">
                  <h4 className="font-label-sm text-outline uppercase tracking-widest mb-md">Go to</h4>
                  <div className="space-y-1">
                    {matchedShortcuts.map((s) => (
                      <button
                        key={s.href}
                        onClick={() => go(s.href)}
                        style={{ width: "100%" }}
                        className="group flex items-center gap-md p-md rounded-xl hover:bg-primary/5 transition-all border border-transparent hover:border-primary/10 text-left"
                      >
                        <div className="w-10 h-10 rounded-lg bg-primary-container/10 flex items-center justify-center text-primary">
                          <span className="material-symbols-outlined">{s.icon}</span>
                        </div>
                        <p className="font-label-md text-on-surface group-hover:text-primary">{s.label}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {matchedClients.length === 0 && matchedShortcuts.length === 0 && (
                <div className="p-xl text-center text-on-surface-variant text-body-sm">No matches found.</div>
              )}
            </div>

            <div className="p-md bg-surface-container border-t border-outline-variant flex items-center justify-between font-label-sm text-outline">
              <div className="flex gap-lg">
                <span className="flex items-center gap-1">
                  <span className="bg-surface-variant px-1 rounded text-on-surface">↵</span> Select
                </span>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
