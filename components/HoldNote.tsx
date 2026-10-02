// Shown to a CLIENT in place of numbers while a report-breaking data problem
// is being fixed (lib/report-hold.ts). Neutral on purpose — nothing's broken
// from their side.
export default function HoldNote() {
  return (
    <div className="card rounded-2xl p-6 flex items-center gap-3">
      <span className="material-symbols-outlined text-[22px]" style={{ color: "var(--text-muted)" }}>hourglass_top</span>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Data being updated</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Your numbers will be back shortly.</p>
      </div>
    </div>
  );
}
