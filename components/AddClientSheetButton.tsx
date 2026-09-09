"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function AddClientSheetButton({
  unconnectedClients,
}: {
  unconnectedClients: { slug: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const disabled = unconnectedClients.length === 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? "Every client already has a sheet connected" : "Connect a sheet for another client"}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
        style={{ border: "1px solid var(--border)", color: "var(--primary)", background: "var(--surface)" }}
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
        Connect another client
      </button>
      {open && !disabled && (
        <div
          className="absolute right-0 z-20 mt-1 rounded-lg overflow-hidden py-1 min-w-[190px] max-h-72 overflow-y-auto"
          style={{ background: "var(--surface-card)", border: "1px solid var(--border)", boxShadow: "0 20px 40px -16px rgba(0,0,0,0.25)" }}
        >
          {unconnectedClients.map((c) => (
            <button
              key={c.slug}
              onClick={() => {
                setOpen(false);
                router.push(`/leads?client=${c.slug}`);
              }}
              className="w-full text-left px-3 py-2 text-sm font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
