"use client";

import { useEffect, useState } from "react";

type ReferralRow = { id: string; name: string; stage: string; createdAt: string };

const STAGE_LABELS: Record<string, string> = {
  INTRODUCED: "Introduced",
  REACHED_OUT: "Reached Out",
  IN_CONVERSATION: "In Conversation",
  CALL_BOOKED: "Call Booked",
  CALL_DONE: "Call Done",
  WON: "Won",
};

export default function ClientReferralPanel({
  code,
  referrals,
}: {
  code: string;
  referrals: ReferralRow[];
}) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);

  const link = `${origin}/refer/${code}`;
  const wonReferrals = referrals.filter((r) => r.stage === "WON");

  function copy() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-5">
      {wonReferrals.length > 0 && (
        <div
          className="rounded-2xl p-5 flex items-center gap-3"
          style={{ background: "linear-gradient(135deg, var(--primary-tint) 0%, var(--surface-card) 100%)", border: "1px solid var(--primary)" }}
        >
          <span className="material-symbols-outlined text-3xl" style={{ color: "var(--primary)" }}>celebration</span>
          <div>
            <p className="font-heading font-bold" style={{ color: "var(--text-primary)" }}>
              {wonReferrals.length === 1 ? "Your referral turned into a client!" : `${wonReferrals.length} of your referrals turned into clients!`}
            </p>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Thank you for spreading the word — {wonReferrals.map((r) => r.name).join(", ")}.
            </p>
          </div>
        </div>
      )}

      <div className="card rounded-2xl p-5">
        <h3 className="font-heading text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Your referral link</h3>
        <p className="mb-4" style={{ color: "var(--text-secondary)" }}>
          Share this with anyone you think we'd be a good fit for — we'll know it came from you.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex-1 px-3 py-2 rounded-lg text-sm truncate" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
            {link || " "}
          </div>
          <button
            onClick={copy}
            className="px-4 py-2 rounded-lg text-sm font-bold shrink-0"
            style={{ background: "var(--primary)", color: "#fff" }}
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>

      <div className="card rounded-2xl p-5">
        <h4 className="font-heading font-bold text-sm mb-3" style={{ color: "var(--text-primary)" }}>Your referrals</h4>
        {referrals.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Nobody's used your link yet — share it to get started.</p>
        ) : (
          <div className="space-y-2">
            {referrals.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg p-3" style={{ background: "var(--surface-hover)" }}>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{r.name}</p>
                <span
                  className="px-2 py-1 rounded-full text-xs font-bold"
                  style={
                    r.stage === "WON"
                      ? { background: "var(--primary-tint)", color: "var(--primary)" }
                      : { background: "var(--surface-card)", color: "var(--text-secondary)" }
                  }
                >
                  {STAGE_LABELS[r.stage] ?? r.stage}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
