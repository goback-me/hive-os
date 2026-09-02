"use client";

import { useState } from "react";
import Link from "next/link";

type Notification = {
  id: string;
  title: string;
  description: string;
  severity: string;
  clientSlug: string;
  computedAt: string;
};

const ICON_MAP: Record<string, { icon: string; bg: string; color: string }> = {
  danger: { icon: "warning", bg: "bg-error-container/20", color: "text-error" },
  warning: { icon: "event_repeat", bg: "bg-secondary-container/20", color: "text-secondary" },
  success: { icon: "event_repeat", bg: "bg-secondary-container/20", color: "text-secondary" },
  muted: { icon: "person_off", bg: "bg-surface-container-highest", color: "text-outline" },
};

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function NotificationsBell({ notifications }: { notifications: Notification[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-2 rounded-full hover:bg-surface-container transition-colors relative"
      >
        <span className="material-symbols-outlined text-on-surface-variant">notifications</span>
        {notifications.length > 0 && (
          <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-error border-2 border-surface rounded-full" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-surface border border-outline-variant rounded-2xl shadow-xl overflow-hidden z-50">
            <div className="px-md py-sm bg-surface-container flex justify-between items-center border-b border-outline-variant">
              <span className="font-label-md text-on-surface">Notifications</span>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {notifications.length === 0 && (
                <div className="p-lg text-center text-body-sm text-on-surface-variant">
                  Nothing needs your attention right now.
                </div>
              )}
              {notifications.map((n) => {
                const style = ICON_MAP[n.severity] ?? ICON_MAP.muted;
                return (
                  <Link
                    key={n.id}
                    href={`/clients/${n.clientSlug}`}
                    onClick={() => setOpen(false)}
                    className="p-md hover:bg-surface-container-low transition-colors border-b border-outline-variant/30 flex gap-md items-start"
                  >
                    <div className={`w-10 h-10 rounded-full ${style.bg} flex items-center justify-center ${style.color} shrink-0`}>
                      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                        {style.icon}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      <p className="font-label-md text-on-surface">{n.title}</p>
                      <p className="font-body-sm text-on-surface-variant line-clamp-2">{n.description}</p>
                      <p className="text-[11px] text-outline font-medium">{timeAgo(n.computedAt)}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
