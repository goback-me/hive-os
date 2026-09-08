"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

type Referral = {
  id: string;
  name: string;
  source: string | null;
  note: string | null;
  stage: string;
  createdAt: string;
  clientName: string | null;
  clientSlug: string | null;
};

const STAGES: { key: string; label: string; color: string }[] = [
  { key: "INTRODUCED", label: "Introduced", color: "var(--text-muted)" },
  { key: "REACHED_OUT", label: "Reached Out", color: "var(--text-secondary)" },
  { key: "IN_CONVERSATION", label: "In Conversation", color: "var(--border-strong)" },
  { key: "CALL_BOOKED", label: "Call Booked", color: "var(--text-primary)" },
  { key: "CALL_DONE", label: "Call Done", color: "var(--primary-hover)" },
  { key: "WON", label: "Won", color: "var(--primary)" },
];

function daysAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  return `${days}d ago`;
}

export default function ReferralBoard({
  initialReferrals,
  onMove,
}: {
  initialReferrals: Referral[];
  onMove: (id: string, stage: string) => Promise<void>;
}) {
  const [referrals, setReferrals] = useState(initialReferrals);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleDrop(stage: string) {
    if (!dragId) return;
    setReferrals((prev) => prev.map((r) => (r.id === dragId ? { ...r, stage } : r)));
    startTransition(() => {
      onMove(dragId, stage);
    });
    setDragId(null);
    setDragOverStage(null);
  }

  return (
    <div className="grid grid-cols-6 gap-3" style={{ minHeight: 500 }}>
      {STAGES.map((stage) => {
        const items = referrals.filter((r) => r.stage === stage.key);
        const isOver = dragOverStage === stage.key;
        return (
          <div
            key={stage.key}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStage(stage.key);
            }}
            onDragLeave={() => setDragOverStage(null)}
            onDrop={() => handleDrop(stage.key)}
            className="rounded-xl p-2 flex flex-col"
            style={{
              background: isOver ? "var(--surface-hover)" : "transparent",
              border: "1px solid var(--border)",
              minHeight: 480,
              transition: "background 0.15s ease",
            }}
          >
            <div className="flex items-center gap-2 px-2 py-2 mb-1">
              <span className="text-xs font-bold" style={{ color: stage.color }}>{stage.label}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{items.length}</span>
            </div>
            <div className="flex-1 space-y-2 px-1">
              {items.length === 0 && (
                <div
                  className="rounded-lg p-4 text-center text-xs"
                  style={{ border: "1px dashed var(--border-strong)", color: "var(--text-muted)" }}
                >
                  Drop here
                </div>
              )}
              {items.map((r) => (
                <div
                  key={r.id}
                  draggable
                  onDragStart={() => setDragId(r.id)}
                  className="card rounded-lg p-3 cursor-grab active:cursor-grabbing"
                  style={{ opacity: dragId === r.id ? 0.4 : 1 }}
                >
                  <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{r.name}</p>
                  {r.clientName && r.clientSlug && (
                    <Link
                      href={`/clients/${r.clientSlug}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-1"
                      style={{ background: "var(--primary-tint)", color: "var(--primary)" }}
                    >
                      <span className="material-symbols-outlined text-[11px]">share</span>
                      via {r.clientName}
                    </Link>
                  )}
                  {r.source && <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{r.source}</p>}
                  {r.note && (
                    <p className="text-xs mt-1 flex items-start gap-1" style={{ color: "var(--text-muted)" }}>
                      <span className="material-symbols-outlined text-[13px] mt-[1px]">group</span>
                      <span className="truncate">{r.note}</span>
                    </p>
                  )}
                  <p className="text-[10px] mt-2" style={{ color: "var(--text-muted)" }}>{daysAgo(r.createdAt)}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
