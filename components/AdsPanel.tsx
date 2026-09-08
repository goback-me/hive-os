type Campaign = {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks?: number;
  profileVisits?: number;
  engagement?: number;
  saves?: number;
  syncedAt?: string | null;
};

function isActive(status: string) {
  return status.toUpperCase() === "ACTIVE";
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  ACTIVE: { bg: "var(--primary-tint)", color: "var(--primary)" },
  PAUSED: { bg: "var(--surface-hover)", color: "var(--text-secondary)" },
  ARCHIVED: { bg: "var(--surface-hover)", color: "var(--text-muted)" },
  DELETED: { bg: "var(--danger-tint)", color: "var(--danger)" },
  WITH_ISSUES: { bg: "var(--danger-tint)", color: "var(--danger)" },
  IN_PROCESS: { bg: "var(--surface-hover)", color: "var(--text-secondary)" },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status.toUpperCase()] ?? { bg: "var(--surface-hover)", color: "var(--text-secondary)" };
  return (
    <span className="px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap" style={{ background: style.bg, color: style.color }}>
      {status.toLowerCase()}
    </span>
  );
}

export default function AdsPanel({ campaigns, source = "manual" }: { campaigns: Campaign[]; source?: "meta" | "manual" }) {
  const totals = campaigns.reduce(
    (acc, c) => ({
      spend: acc.spend + c.spend,
      impressions: acc.impressions + c.impressions,
      clicks: acc.clicks + (c.clicks ?? 0),
      active: acc.active + (isActive(c.status) ? 1 : 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, active: 0 }
  );

  // Meta-sourced campaigns are connected by definition; manually-tracked
  // ones only count as "connected" once something has actually synced.
  const isConnected = source === "meta" || campaigns.some((c) => c.syncedAt);

  return (
    <div>
      {!isConnected && (
        <div
          className="rounded-xl p-3 mb-4 flex items-center gap-2 text-sm"
          style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}
        >
          <span className="material-symbols-outlined text-[18px]">info</span>
          Not connected to Meta Ads or your server-side tracker yet — showing $0 until that's wired up in Settings.
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="card rounded-2xl p-4">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Total Spend{source === "meta" && <span style={{ color: "var(--text-muted)" }}> · all-time</span>}
          </p>
          <p className="font-heading text-2xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>${totals.spend.toLocaleString()}</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Impressions</p>
          <p className="font-heading text-2xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>{totals.impressions.toLocaleString()}</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Link Clicks</p>
          <p className="font-heading text-2xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>{totals.clicks.toLocaleString()}</p>
        </div>
        <div className="card rounded-2xl p-4">
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Active Campaigns</p>
          <p className="font-heading text-2xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>{totals.active}</p>
        </div>
      </div>

      <div className="card rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {(source === "meta"
                ? ["Campaign", "Status", "Spend", "Impressions", "Clicks"]
                : ["Campaign", "Status", "Spend", "Impressions", "Profile Visits", "Engagement", "Saves"]
              ).map((h) => (
                <th key={h} className="text-left px-4 py-3 font-medium" style={{ color: "var(--text-muted)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>{c.name}</td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>${c.spend.toLocaleString()}</td>
                <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>{c.impressions.toLocaleString()}</td>
                {source === "meta" ? (
                  <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>{(c.clicks ?? 0).toLocaleString()}</td>
                ) : (
                  <>
                    <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>{(c.profileVisits ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>{(c.engagement ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-3" style={{ color: "var(--text-primary)" }}>{(c.saves ?? 0).toLocaleString()}</td>
                  </>
                )}
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={source === "meta" ? 5 : 7} className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
                  No campaigns yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
