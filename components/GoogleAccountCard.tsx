"use client";

// Single, app-wide Google connection — connect it once, every client's
// sheet is then read through this one account. Not per-client OAuth.
export default function GoogleAccountCard({
  connected,
  googleEmail,
}: {
  connected: boolean;
  googleEmail: string | null;
}) {
  function disconnect() {
    if (!confirm("Disconnect the Hive Google account? Every client's leads will stop loading until you reconnect.")) return;
    fetch("/api/google/disconnect", { method: "POST" }).then(() => window.location.reload());
  }

  return (
    <div className="custom-card p-lg mb-lg flex items-center justify-between flex-wrap gap-md">
      <div className="flex items-center gap-md">
        <div className="w-10 h-10 rounded-full bg-primary-container/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-primary text-[20px]">
            {connected ? "check_circle" : "link_off"}
          </span>
        </div>
        <div>
          <h4 className="font-label-md text-on-surface">
            {connected ? "Google account connected" : "No Google account connected"}
          </h4>
          <p className="text-body-sm text-on-surface-variant">
            {connected
              ? `Reading client sheets as ${googleEmail ?? "connected account"}`
              : "Connect once — used to read every client's lead sheet"}
          </p>
        </div>
      </div>
      {connected ? (
        <button
          onClick={disconnect}
          className="flex items-center gap-xs px-md py-2 border border-outline-variant rounded-lg font-label-sm text-red-600 hover:bg-red-50"
        >
          <span className="material-symbols-outlined text-[16px]">link_off</span>
          Disconnect
        </button>
      ) : (
        <a
          href="/api/google/connect"
          className="flex items-center gap-sm px-lg py-2 bg-primary text-white rounded-lg font-label-md hover:opacity-90"
        >
          <span className="material-symbols-outlined text-[18px]">link</span>
          Connect Google account
        </a>
      )}
    </div>
  );
}
