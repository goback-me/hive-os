"use client";

// Single, app-wide Google connection — connect it once, every client's
// sheet is then read through this one account. Not per-client OAuth.
export default function GoogleAccountCard({
  connected,
  googleEmail,
  canWrite,
}: {
  connected: boolean;
  googleEmail: string | null;
  canWrite: boolean; // granted the read/write sheets scope — status write-back needs it
}) {
  function disconnect() {
    if (!confirm("Disconnect the Google account? Every client's leads will stop loading until you reconnect.")) return;
    fetch("/api/google/disconnect", { method: "POST" }).then(() => window.location.reload());
  }

  return (
    <div className="space-y-3">
    {connected && !canWrite && (
      <div className="rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3" style={{ background: "var(--tag-amber-bg)", color: "var(--tag-amber-fg)" }}>
        <p className="text-sm font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">warning</span>
          Reconnect Google (write access needed) — status changes made in HQ can't be written back to the sheets until you do.
        </p>
        <a href="/api/google/connect" className="btn-gradient flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold">
          <span className="material-symbols-outlined text-[18px]">sync</span>
          Reconnect Google
        </a>
      </div>
    )}
    <div className="card rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
      <div className="flex items-center gap-3">
        <div className="glow-tile w-10 h-10 rounded-full flex items-center justify-center">
          <span className="material-symbols-outlined text-[20px]" style={{ color: "var(--primary)" }}>
            {connected ? "check_circle" : "link_off"}
          </span>
        </div>
        <div>
          <h4 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {connected ? "Google account connected" : "No Google account connected"}
          </h4>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {connected
              ? `${canWrite ? "Syncing" : "Reading"} client sheets as ${googleEmail ?? "connected account"}`
              : "Connect once — used to read every client's lead sheet"}
          </p>
        </div>
      </div>
      {connected ? (
        <button
          onClick={disconnect}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold"
          style={{ border: "1px solid var(--border)", color: "var(--danger)" }}
        >
          <span className="material-symbols-outlined text-[16px]">link_off</span>
          Disconnect
        </button>
      ) : (
        <a
          href="/api/google/connect"
          className="btn-gradient flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold"
        >
          <span className="material-symbols-outlined text-[18px]">link</span>
          Connect Google account
        </a>
      )}
    </div>
    </div>
  );
}
