// A client's health (lib/client-health.ts): the effective level, and — when a
// coach overrode it — the computed one too. The warning signs are the tooltip.
const STYLE = {
  ON_TRACK: { label: "On track", bg: "var(--tag-green-bg)", fg: "var(--tag-green-fg)" },
  AT_RISK: { label: "At risk", bg: "var(--tag-amber-bg)", fg: "var(--tag-amber-fg)" },
  CRITICAL: { label: "Critical", bg: "var(--danger-tint)", fg: "var(--danger)" },
} as const;
type Level = keyof typeof STYLE;

export default function HealthBadge({ health, size = "sm" }: { health: { effective: Level; level: Level; override: Level | null; reasons: string[] }; size?: "sm" | "md" }) {
  const s = STYLE[health.effective];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-bold whitespace-nowrap ${size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]"}`}
      style={{ background: s.bg, color: s.fg }}
      title={health.reasons.join(" · ") || "No warning signs"}
    >
      {s.label}
      {health.override && <span className="font-medium opacity-80">· set (computed {STYLE[health.level].label.toLowerCase()})</span>}
    </span>
  );
}
