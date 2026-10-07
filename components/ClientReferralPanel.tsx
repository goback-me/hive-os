"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// What a client gets for a referral that becomes a client. One place to change it.
export const REFERRAL_REWARD = { headline: "$500 off a month", detail: "off your monthly service fee for every business you refer that becomes a client" };

type ReferralRow = { id: string; name: string; stage: string; createdAt: string };

const STAGE_LABELS: Record<string, string> = {
  INTRODUCED: "Introduced",
  REACHED_OUT: "Reached Out",
  IN_CONVERSATION: "In Conversation",
  CALL_BOOKED: "Call Booked",
  CALL_DONE: "Call Done",
  WON: "Won",
};

// The client's Referrals tab: the reward, their link, a form to refer someone
// by hand (→ the referral pipeline, submitClientReferral) and how theirs are going.
export default function ClientReferralPanel({
  clientId,
  code,
  referrals,
  onSubmit,
}: {
  clientId: string;
  code: string;
  referrals: ReferralRow[];
  onSubmit: (clientId: string, input: { name: string; phone: string; email: string; note: string }) => Promise<void>;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", phone: "", email: "", note: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const input = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const submit = () =>
    startTransition(async () => {
      setMsg(null);
      try {
        await onSubmit(clientId, form);
        setMsg({ ok: true, text: `Thanks — we'll reach out to ${form.name.trim()} and keep you posted here.` });
        setForm({ name: "", phone: "", email: "", note: "" });
        router.refresh();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't send it" });
      }
    });
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

      <div className="rounded-2xl p-5 flex items-center gap-4" style={{ background: "linear-gradient(135deg, var(--primary) 0%, #4f46e5 100%)", color: "#fff" }}>
        <span className="material-symbols-outlined text-4xl">redeem</span>
        <div>
          <p className="font-heading text-2xl font-bold">Get {REFERRAL_REWARD.headline}</p>
          <p className="text-sm opacity-90">{REFERRAL_REWARD.headline.replace(" a month", "")} {REFERRAL_REWARD.detail}.</p>
        </div>
      </div>

      <div className="card rounded-2xl p-5 space-y-3">
        <div>
          <h3 className="font-heading text-xl font-bold" style={{ color: "var(--text-primary)" }}>Refer someone</h3>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Know a business we could help? Pop their details in — we&apos;ll take it from here.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name / business *" className="px-3 py-2 rounded-lg text-sm outline-none" style={input} aria-label="Name or business" />
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" type="tel" className="px-3 py-2 rounded-lg text-sm outline-none" style={input} aria-label="Phone" />
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" className="px-3 py-2 rounded-lg text-sm outline-none" style={input} aria-label="Email" />
        </div>
        <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} placeholder="Anything we should know? (what they do, best time to call…)" className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none" style={input} aria-label="Note" />
        <div className="flex items-center gap-3">
          <button onClick={submit} disabled={pending || !form.name.trim() || (!form.phone.trim() && !form.email.trim())} className="btn-gradient px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
            {pending ? "Sending…" : "Send referral"}
          </button>
          {msg && <p className="text-sm" style={{ color: msg.ok ? "var(--tag-green-fg)" : "var(--danger)" }}>{msg.text}</p>}
        </div>
      </div>

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
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No referrals yet — share your link or refer someone above.</p>
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
