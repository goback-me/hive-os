"use client";

import { useEffect, useState } from "react";

type Insights = {
  spend: number;
  impressions: number;
  clicks: number;
  cpm: number;
  ctr: number;
  conversions: number;
  costPerConversion: number | null;
};

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

  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);

  function loadInsights() {
    setLoading(true);
    setError(null);
    fetch(`/api/meta/insights?clientId=${clientId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setInsights(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (connected && !showForm) loadInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, showForm]);

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

  return (
    <div className="custom-card p-lg">
      <div className="flex justify-between items-center mb-md">
        <h4 className="font-headline-sm text-primary">Meta Ads</h4>
        {connected && !showForm ? (
          <span className="px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded uppercase">Connected</span>
        ) : (
          <span className="px-2 py-1 bg-surface-container text-on-surface-variant text-[10px] font-bold rounded uppercase">
            Not connected
          </span>
        )}
      </div>

      {error && <p className="text-body-sm text-red-600 mb-md">{error}</p>}

      {(!connected || showForm) && (
        <div className="p-md border border-outline-variant rounded-xl space-y-sm">
          <div>
            <label className="text-label-sm text-on-surface-variant block mb-xs">Ad account ID</label>
            <input
              type="text"
              placeholder="act_123456789 (or just the digits)"
              value={inputAccountId}
              onChange={(e) => setInputAccountId(e.target.value)}
              className="w-full px-md py-2 border border-outline-variant rounded-lg text-body-sm"
            />
          </div>
          <div>
            <label className="text-label-sm text-on-surface-variant block mb-xs">Access token</label>
            <input
              type="password"
              placeholder="Paste the client's Meta access token"
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              className="w-full px-md py-2 border border-outline-variant rounded-lg text-body-sm"
            />
            <p className="text-label-sm text-on-surface-variant mt-xs">
              Encrypted before it's stored — only this app can decrypt it, nobody can read it back out via the UI or API.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving || !inputAccountId || !inputToken}
            className="px-md py-2 bg-primary text-white rounded-lg font-label-sm hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Verifying…" : "Connect"}
          </button>
          {connected && (
            <button onClick={() => setShowForm(false)} className="ml-sm px-md py-2 border border-outline-variant rounded-lg font-label-sm">
              Cancel
            </button>
          )}
        </div>
      )}

      {connected && !showForm && (
        <div>
          <p className="text-label-sm text-on-surface-variant mb-md">{adAccountId} · last 30 days</p>

          {loading && <p className="text-body-sm text-on-surface-variant">Loading…</p>}

          {insights && !loading && (
            <div className="grid grid-cols-2 gap-md mb-md">
              <Metric label="Spend" value={`$${insights.spend.toLocaleString()}`} />
              <Metric label="Conversions" value={String(insights.conversions)} />
              <Metric label="Cost / conversion" value={insights.costPerConversion ? `$${insights.costPerConversion.toFixed(2)}` : "—"} />
              <Metric label="CTR" value={`${insights.ctr.toFixed(2)}%`} />
              <Metric label="Impressions" value={insights.impressions.toLocaleString()} />
              <Metric label="Clicks" value={insights.clicks.toLocaleString()} />
            </div>
          )}

          <div className="flex gap-sm">
            <button onClick={() => window.location.reload()} className="px-md py-2 border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container">
              Refresh
            </button>
            <button onClick={() => setShowForm(true)} className="px-md py-2 border border-outline-variant rounded-lg font-label-sm hover:bg-surface-container">
              Change account
            </button>
            <button onClick={disconnect} className="px-md py-2 border border-outline-variant rounded-lg font-label-sm text-red-600 hover:bg-red-50">
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-label-sm text-on-surface-variant">{label}</p>
      <p className="font-headline-sm text-primary">{value}</p>
    </div>
  );
}