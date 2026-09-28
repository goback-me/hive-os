// Shown instantly (inside the sidebar layout) while any app page loads —
// client pages pull a lot of data, so this beats a frozen screen.
export default function Loading() {
  return (
    <div className="flex items-center justify-center py-32" role="status" aria-label="Loading">
      <span className="material-symbols-outlined text-4xl animate-spin" style={{ color: "var(--primary)" }}>
        progress_activity
      </span>
    </div>
  );
}
