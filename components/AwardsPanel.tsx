type Tier = { id: string; name: string; subtitle: string | null; thresholdRevenue: number | null };

export default function AwardsPanel({
  tiers,
  earnedTierIds,
  earnedAtByTierId,
  lifetimeRevenue,
}: {
  tiers: Tier[];
  earnedTierIds: string[];
  earnedAtByTierId: Record<string, string>;
  lifetimeRevenue: number;
}) {
  const nextLocked = tiers.find((t) => !earnedTierIds.includes(t.id) && t.thresholdRevenue);
  const remaining = nextLocked?.thresholdRevenue ? Number(nextLocked.thresholdRevenue) - lifetimeRevenue : 0;

  return (
    <div>
      <h3 className="font-heading text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Awards</h3>
      {nextLocked && (
        <p className="mb-6" style={{ color: "var(--text-secondary)" }}>
          You've generated ${lifetimeRevenue.toLocaleString()} in lifetime revenue. ${Math.max(remaining, 0).toLocaleString()} more to unlock {nextLocked.name}.
        </p>
      )}
      <div className="grid grid-cols-3 gap-5">
        {tiers.map((tier) => {
          const earned = earnedTierIds.includes(tier.id);
          const threshold = tier.thresholdRevenue ?? 0;
          const tierRemaining = Math.max(threshold - lifetimeRevenue, 0);
          const progressPct = threshold > 0 ? Math.min((lifetimeRevenue / threshold) * 100, 100) : earned ? 100 : 0;
          const earnedAt = earnedAtByTierId[tier.id];

          return (
            <div
              key={tier.id}
              className="relative rounded-3xl p-8 flex flex-col items-center text-center overflow-hidden transition-transform"
              style={{
                background: earned
                  ? "linear-gradient(160deg, var(--primary-tint) 0%, var(--surface-card) 70%)"
                  : "var(--surface-card)",
                border: `1.5px solid ${earned ? "var(--primary)" : "var(--border)"}`,
                boxShadow: earned ? "0 0 40px -10px var(--primary)" : "none",
              }}
            >
              {earned && (
                <div
                  className="absolute top-0 right-6 text-[10px] font-bold px-3 py-1.5 rounded-b-lg flex items-center gap-1"
                  style={{ background: "var(--primary)", color: "#fff" }}
                >
                  <span className="material-symbols-outlined text-[13px]">military_tech</span>
                  EARNED
                </div>
              )}

              <div
                className="w-20 h-20 rounded-full flex items-center justify-center mb-4 relative"
                style={{
                  background: earned
                    ? "conic-gradient(from 180deg, var(--primary), var(--primary-tint), var(--primary))"
                    : "var(--surface-hover)",
                  padding: 3,
                }}
              >
                <div
                  className="w-full h-full rounded-full flex items-center justify-center"
                  style={{ background: earned ? "var(--primary)" : "var(--surface)" }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 36, color: earned ? "#fff" : "var(--text-muted)" }}
                  >
                    {earned ? "emoji_events" : "lock"}
                  </span>
                </div>
                {earned && (
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{ boxShadow: "0 0 24px 4px var(--primary)", opacity: 0.5 }}
                  />
                )}
              </div>

              <p
                className="font-heading text-3xl font-bold mb-1"
                style={{ color: earned ? "var(--text-primary)" : "var(--text-secondary)" }}
              >
                {tier.name}
              </p>
              {tier.subtitle && (
                <p
                  className="text-xs font-bold tracking-widest mb-4 px-3 py-1 rounded-full"
                  style={{
                    color: earned ? "var(--primary)" : "var(--text-muted)",
                    background: earned ? "var(--primary-tint)" : "var(--surface-hover)",
                  }}
                >
                  {tier.subtitle.toUpperCase()}
                </p>
              )}

              <div className="w-full pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                {earned ? (
                  <p className="text-xs flex items-center justify-center gap-1" style={{ color: "var(--text-muted)" }}>
                    <span className="material-symbols-outlined text-[14px]">event_available</span>
                    Earned {earnedAt ? new Date(earnedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
                  </p>
                ) : threshold > 0 ? (
                  <>
                    <div className="h-1.5 rounded-full mb-2" style={{ background: "var(--surface-hover)" }}>
                      <div className="h-1.5 rounded-full" style={{ width: `${progressPct}%`, background: "var(--primary)" }} />
                    </div>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      ${tierRemaining.toLocaleString()} to go
                    </p>
                  </>
                ) : (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>Complete the required module to unlock</p>
                )}
              </div>
            </div>
          );
        })}
        {tiers.length === 0 && <p style={{ color: "var(--text-secondary)" }}>No award tiers set up yet.</p>}
      </div>
    </div>
  );
}
