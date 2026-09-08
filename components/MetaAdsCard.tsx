"use client";

import { useState } from "react";

export default function MetaAdsCard({
  clientId,
  connected,
  adAccountId,
}: {
  clientId: string;
  connected: boolean;
  adAccountId: string | null;
}) {
  const [showForm, setShowForm] = useState(!connected);
  const [inputAccountId, setInputAccountId] = useState("");
  const [inputToken, setInputToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!inputAccountId || !inputToken) return;
    setSaving(true);
    setError(null);
    fetch("/api/meta/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, adAccountId: inputAccountId, accessToken: inputToken }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setShowForm(false);
        setInputToken(""); // never keep the raw token in memory longer than needed
        window.location.reload();
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  }

  function disconnect() {
    if (!confirm("Disconnect Meta Ads for this client?")) return;
    fetch("/api/meta/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    }).then(() => window.location.reload());
  }

  const inputStyle = {
    width: "100%",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text-primary)",
  } as const;

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex justify-between items-center mb-3">
        <h4 className="font-heading font-bold text-sm" style={{ color: "var(--text-primary)" }}>Meta Ads</h4>
        {connected && !showForm ? (
          <span className="px-2 py-1 text-[10px] font-bold rounded uppercase" style={{ background: "var(--primary-tint)", color: "var(--primary)" }}>
            Connected
          </span>
        ) : (
          <span className="px-2 py-1 text-[10px] font-bold rounded uppercase" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
            Not connected
          </span>
        )}
      </div>

      {error && <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>{error}</p>}

      {(!connected || showForm) && (
        <div className="p-3 rounded-xl space-y-2" style={{ border: "1px solid var(--border)" }}>
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Ad account ID</label>
            <input
              type="text"
              placeholder="act_123456789 (or just the digits)"
              value={inputAccountId}
              onChange={(e) => setInputAccountId(e.target.value)}
              className="px-3 py-2 rounded-lg outline-none text-sm"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Access token</label>
            <input
              type="password"
              placeholder="Paste the client's Meta access token"
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              className="px-3 py-2 rounded-lg outline-none text-sm"
              style={inputStyle}
            />
            <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
              Encrypted before it's stored — only this app can decrypt it, nobody can read it back out via the UI or API.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving || !inputAccountId || !inputToken}
            className="btn-gradient px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
          >
            {saving ? "Verifying…" : "Connect"}
          </button>
          {connected && (
            <button
              onClick={() => setShowForm(false)}
              className="ml-2 px-4 py-2 rounded-lg text-xs font-bold"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {connected && !showForm && (
        <div>
          <div className="flex items-center gap-3 p-3 rounded-xl mb-4" style={{ background: "var(--surface-hover)" }}>
            <span className="icon-chip w-10 h-10 shrink-0" style={{ background: "var(--primary-tint)" }}>
              <span className="material-symbols-outlined text-[20px]" style={{ color: "var(--primary)" }}>campaign</span>
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{adAccountId}</p>
              <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--primary)" }} />
                Live — full campaign breakdown is on the Ads tab above
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-2 rounded-lg text-xs font-bold"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              Refresh
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-2 rounded-lg text-xs font-bold"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              Change account
            </button>
            <button
              onClick={disconnect}
              className="px-3 py-2 rounded-lg text-xs font-bold"
              style={{ border: "1px solid var(--border)", color: "var(--danger)" }}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
