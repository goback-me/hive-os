"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";

type ClientCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  scope: string | null;
  revenue: number;
};

const STATUS_STYLE: Record<string, { dot: string; bg: string; color: string; label: string }> = {
  ACTIVE: { dot: "var(--primary)", bg: "var(--primary-tint)", color: "var(--primary)", label: "Active" },
  ONBOARDING: { dot: "var(--text-secondary)", bg: "var(--surface-hover)", color: "var(--text-secondary)", label: "Onboarding" },
  CHURNED: { dot: "var(--danger)", bg: "var(--danger-tint)", color: "var(--danger)", label: "Not Active" },
};

export default function ClientsGrid({
  clients,
  onBulkUpdateStatus,
  onArchive,
  onUnarchive,
  onDeletePermanently,
  view = "active",
}: {
  clients: ClientCard[];
  onBulkUpdateStatus: (clientIds: string[], status: string) => Promise<void>;
  onArchive: (clientId: string) => Promise<void>;
  onUnarchive: (clientId: string) => Promise<void>;
  onDeletePermanently: (clientId: string) => Promise<void>;
  view?: "active" | "not-active" | "archived";
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("ACTIVE");
  const [applying, setApplying] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const archivedView = view === "archived";

  function handleArchiveToggle(e: MouseEvent, clientId: string) {
    e.preventDefault();
    e.stopPropagation();
    setArchiving(clientId);
    const action = archivedView ? onUnarchive : onArchive;
    action(clientId).finally(() => setArchiving(null));
  }

  function handleDelete(e: MouseEvent, clientId: string, clientName: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Permanently delete ${clientName}? This deletes all their data — leads, sessions, payments, everything. This cannot be undone.`)) {
      return;
    }
    setDeleting(clientId);
    onDeletePermanently(clientId).finally(() => setDeleting(null));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cancel() {
    setSelecting(false);
    setSelected(new Set());
  }

  function apply() {
    setApplying(true);
    onBulkUpdateStatus(Array.from(selected), bulkStatus).finally(() => {
      setApplying(false);
      cancel();
    });
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => (selecting ? cancel() : setSelecting(true))}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
          style={
            selecting
              ? { background: "var(--surface-hover)", color: "var(--text-primary)" }
              : { border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }
          }
        >
          <span className="material-symbols-outlined text-[18px]">{selecting ? "close" : "check_box_outline_blank"}</span>
          {selecting ? "Cancel" : "Bulk Edit"}
        </button>
      </div>

      {selecting && (
        <div className="card rounded-xl p-3 mb-4 flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {selected.size} selected — click clients below to select
          </p>
          <div className="flex items-center gap-2">
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            >
              <option value="ACTIVE">Set to Active</option>
              <option value="ONBOARDING">Set to Onboarding</option>
              <option value="CHURNED">Set to Not Active</option>
            </select>
            <button
              onClick={apply}
              disabled={selected.size === 0 || applying}
              className="px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
              style={{ background: "var(--primary)", color: "#fff" }}
            >
              {applying ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {clients.map((client) => {
          const s = STATUS_STYLE[client.status] ?? STATUS_STYLE.ONBOARDING;
          const isSelected = selected.has(client.id);
          const cardInner = (
            <>
              {selecting && (
                <span
                  className="absolute top-4 left-4 w-5 h-5 rounded-md flex items-center justify-center"
                  style={{ background: isSelected ? "var(--primary)" : "var(--surface-hover)", border: isSelected ? "none" : "1.5px solid var(--border-strong)" }}
                >
                  {isSelected && <span className="material-symbols-outlined text-[14px]" style={{ color: "#fff" }}>check</span>}
                </span>
              )}
              <span
                className="absolute top-4 right-4 w-2.5 h-2.5 rounded-full"
                style={{ background: s.dot }}
              />
              {!selecting && archivedView && (
                <button
                  onClick={(e) => handleDelete(e, client.id, client.name)}
                  disabled={deleting === client.id}
                  title="Delete permanently"
                  className="absolute top-3 right-14 w-7 h-7 rounded-md flex items-center justify-center disabled:opacity-50"
                  style={{ color: "var(--danger)" }}
                >
                  <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                </button>
              )}
              {!selecting && (
                <button
                  onClick={(e) => handleArchiveToggle(e, client.id)}
                  disabled={archiving === client.id}
                  title={archivedView ? "Unarchive" : "Archive"}
                  className="absolute top-3 right-8 w-7 h-7 rounded-md flex items-center justify-center disabled:opacity-50"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {archivedView ? "unarchive" : "archive"}
                  </span>
                </button>
              )}
              <div className="flex items-start gap-3 mb-4">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: "var(--primary-tint)", color: "var(--primary)" }}
                >
                  {client.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{client.name}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                    {client.description || " "}
                  </p>
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Revenue this month</p>
                  <p className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
                    ${client.revenue.toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold" style={{ color: s.color }}>{s.label}</p>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{client.scope ?? "—"}</p>
                </div>
              </div>
            </>
          );

          return selecting ? (
            <button
              key={client.id}
              onClick={() => toggle(client.id)}
              className="card rounded-xl p-4 relative text-left"
              style={{ outline: isSelected ? "2px solid var(--primary)" : "none" }}
            >
              {cardInner}
            </button>
          ) : (
            <Link key={client.id} href={`/clients/${client.slug}`} className="card rounded-xl p-4 block relative">
              {cardInner}
            </Link>
          );
        })}
        {clients.length === 0 && <p style={{ color: "var(--text-secondary)" }}>No clients yet.</p>}
      </div>
    </div>
  );
}
