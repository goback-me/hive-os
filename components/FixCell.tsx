"use client";

import { useState } from "react";
import { DQ_REASONS, DQ_REASON_LABELS, LOST_REASONS, LOST_REASON_LABELS, type LeadStageValue } from "@/lib/lead-status";

// Shared by the Leads tab's "Needs fixing" list and the lead alerts' Fix panel.
// What a "Needs fixing" row is missing, with an in-place control to fill it.
export function FixCell({ lead, onFix }: { lead: { stage: LeadStageValue }; onFix: (target: string, value?: number) => void }) {
  const [value, setValue] = useState("");
  const missing = (text: string) => <p className="text-[10px] font-bold mb-1" style={{ color: "var(--danger)" }}>{text}</p>;
  const selectStyle = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };

  if (lead.stage === "DISQUALIFIED" || lead.stage === "LOST") {
    const dq = lead.stage === "DISQUALIFIED";
    const reasons = (dq ? DQ_REASONS : LOST_REASONS).filter((r) => r !== "UNKNOWN");
    const labels: Record<string, string> = dq ? DQ_REASON_LABELS : LOST_REASON_LABELS;
    return (
      <div>
        {missing(dq ? "No DQ reason" : "No lost reason")}
        <select value="" onChange={(e) => e.target.value && onFix(`${lead.stage}:${e.target.value}`)} className="px-2 py-1 rounded-lg text-xs outline-none" style={selectStyle}>
          <option value="">Pick reason…</option>
          {reasons.map((r) => (
            <option key={r} value={r}>{labels[r]}</option>
          ))}
        </select>
      </div>
    );
  }
  if (lead.stage === "WON" || lead.stage === "QUOTE_SENT") {
    const n = Number(value);
    const ok = value.trim() !== "" && Number.isFinite(n) && n >= 0;
    return (
      <div>
        {missing(lead.stage === "WON" ? "No job value" : "No quote value")}
        <div className="flex gap-1.5">
          <input
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && ok) onFix(lead.stage, n); }}
            placeholder="e.g. 12000"
            className="w-24 px-2 py-1 rounded-lg text-xs outline-none"
            style={selectStyle}
          />
          <button disabled={!ok} onClick={() => onFix(lead.stage, n)} className="px-2 py-1 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: "var(--primary)", color: "#fff" }}>
            Save
          </button>
        </div>
      </div>
    );
  }
  return null;
}
