"use client";

import { useEffect, useState } from "react";

type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  webViewLink?: string;
};

type BrowseResult =
  | { type: "folder"; meta: DriveItem; children: DriveItem[] }
  | { type: "file"; meta: DriveItem };

const FOLDER_MIME = "application/vnd.google-apps.folder";

// Every file opens in a real Google tab (Docs/Sheets/Slides in their native
// editor, everything else in Drive's own viewer) instead of being streamed
// through our PDF-export proxy — a PDF export is nothing like the real
// document. This does mean whoever clicks needs their own Google account to
// have access to that specific file (shared by the coach, or org-wide) —
// see the note in Settings. Our /api/google/drive/browse route still gates
// who can even SEE this folder listing in the first place (only the coach
// or that specific client), independent of Google's own file permissions.
function driveOpenUrl(item: DriveItem): string {
  if (item.webViewLink) return item.webViewLink;
  switch (item.mimeType) {
    case "application/vnd.google-apps.document":
      return `https://docs.google.com/document/d/${item.id}/edit`;
    case "application/vnd.google-apps.spreadsheet":
      return `https://docs.google.com/spreadsheets/d/${item.id}/edit`;
    case "application/vnd.google-apps.presentation":
      return `https://docs.google.com/presentation/d/${item.id}/edit`;
    default:
      return `https://drive.google.com/file/d/${item.id}/view`;
  }
}

function driveOpenLabel(mimeType: string): { label: string; icon: string } {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return { label: "Open in Google Docs", icon: "description" };
    case "application/vnd.google-apps.spreadsheet":
      return { label: "Open in Google Sheets", icon: "table_chart" };
    case "application/vnd.google-apps.presentation":
      return { label: "Open in Google Slides", icon: "slideshow" };
    default:
      return { label: "Open in Google Drive", icon: "open_in_new" };
  }
}

function formatDate(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function GameplanPanel({
  clientId,
  currentLink,
  onSave,
}: {
  clientId: string;
  currentLink: string | null;
  onSave: (clientId: string, formData: FormData) => Promise<void>;
}) {
  const [link, setLink] = useState(currentLink ?? "");
  const isDriveLink = /^https:\/\/(?:drive|docs)\.google\.com\/(?:file\/d|document\/d|spreadsheets\/d|presentation\/d|drive\/folders)\/[a-zA-Z0-9_-]+/.test(link);
  const hasUnsavedChanges = link !== (currentLink ?? "");

  // Path of folders drilled into below the saved root link, so a folder
  // Gameplan can be browsed like a normal Drive folder view.
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPath([]);
  }, [currentLink]);

  useEffect(() => {
    if (!currentLink) {
      setResult(null);
      return;
    }
    const folderId = path[path.length - 1]?.id;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ clientId, ...(folderId ? { id: folderId } : {}) });
    fetch(`/api/google/drive/browse?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setResult(data);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [clientId, currentLink, path]);

  return (
    <div>
      <h3 className="font-heading text-xl font-bold mb-1" style={{ color: "var(--text-primary)" }}>Gameplan</h3>
      <p className="mb-4" style={{ color: "var(--text-secondary)" }}>Embed a Google Drive doc or folder for this client's strategy.</p>

      <div className="card rounded-2xl p-5 mb-4">
        <label className="text-xs font-semibold block mb-2" style={{ color: "var(--text-secondary)" }}>Google Drive Link</label>
        <form action={onSave.bind(null, clientId)} className="flex gap-2">
          <input
            name="figmaLink"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://drive.google.com/file/d/..."
            style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            className="px-3 py-2 rounded-lg outline-none text-sm"
          />
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1 btn-cta" style={{ background: "var(--secondary)", color: "#fff" }}>
            <span className="material-symbols-outlined text-[16px]">save</span>
            Save
          </button>
        </form>
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          Paste a Google Drive file, folder, or Doc/Sheet/Slide link. Folders are browsed through Hive's connected
          Google account, so the folder itself doesn't need to be public — but opening a file hands off to Google's
          own tab, so that file needs to be shared with whoever's viewing (or set to "Anyone with the link").
        </p>
        {link && !isDriveLink && (
          <p className="text-xs mt-2 font-semibold" style={{ color: "var(--danger, #e11d48)" }}>
            That doesn't look like a Drive/Docs/Sheets/Slides link.
          </p>
        )}
        {hasUnsavedChanges && isDriveLink && (
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>Save to update the preview below.</p>
        )}
      </div>

      {!currentLink ? (
        <div className="card rounded-2xl p-10 text-center" style={{ border: "1px dashed var(--border-strong)" }}>
          <span className="material-symbols-outlined text-4xl mb-2" style={{ color: "var(--text-muted)" }}>auto_awesome</span>
          <p className="font-semibold" style={{ color: "var(--text-primary)" }}>No gameplan linked yet</p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Paste a Google Drive link above to embed the strategy for this client.</p>
        </div>
      ) : loading ? (
        <div className="card rounded-2xl p-10 text-center" style={{ color: "var(--text-secondary)" }}>Loading from Drive…</div>
      ) : error ? (
        <div className="card rounded-2xl p-10 text-center" style={{ color: "var(--danger, #e11d48)" }}>{error}</div>
      ) : result?.type === "folder" ? (
        <div className="card rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>
            <button
              onClick={() => setPath([])}
              disabled={path.length === 0}
              className="font-semibold disabled:opacity-100 disabled:cursor-default"
              style={{ color: path.length === 0 ? "var(--text-primary)" : "var(--primary)" }}
            >
              Gameplan
            </button>
            {path.map((p, i) => (
              <span key={p.id} className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                <button
                  onClick={() => setPath(path.slice(0, i + 1))}
                  disabled={i === path.length - 1}
                  className="font-semibold disabled:opacity-100 disabled:cursor-default"
                  style={{ color: i === path.length - 1 ? "var(--text-primary)" : "var(--primary)" }}
                >
                  {p.name}
                </button>
              </span>
            ))}
          </div>
          {result.children.length === 0 ? (
            <div className="p-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>This folder is empty.</div>
          ) : (
            <div>
              {result.children.map((item) => {
                const isFolder = item.mimeType === FOLDER_MIME;
                const open = () => {
                  if (isFolder) setPath([...path, { id: item.id, name: item.name }]);
                  else window.open(driveOpenUrl(item), "_blank", "noopener,noreferrer");
                };
                return (
                  <button
                    key={item.id}
                    onClick={open}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    {item.iconLink ? (
                      <img src={item.iconLink} alt="" className="w-5 h-5 shrink-0" />
                    ) : (
                      <span className="material-symbols-outlined text-[20px] shrink-0" style={{ color: "var(--text-muted)" }}>
                        {isFolder ? "folder" : "description"}
                      </span>
                    )}
                    <span className="flex-1 text-sm truncate" style={{ color: "var(--text-primary)" }}>{item.name}</span>
                    <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>{formatDate(item.modifiedTime)}</span>
                    {!isFolder && (
                      <span className="material-symbols-outlined text-[16px] shrink-0" style={{ color: "var(--text-muted)" }}>open_in_new</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : result?.type === "file" ? (
        <div className="card rounded-2xl p-10 text-center">
          <span className="material-symbols-outlined text-4xl mb-2" style={{ color: "var(--text-muted)" }}>
            {driveOpenLabel(result.meta.mimeType).icon}
          </span>
          <p className="font-semibold mb-3" style={{ color: "var(--text-primary)" }}>{result.meta.name}</p>
          <a
            href={driveOpenUrl(result.meta)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-bold btn-cta"
            style={{ background: "var(--secondary)", color: "#fff" }}
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            {driveOpenLabel(result.meta.mimeType).label}
          </a>
        </div>
      ) : null}
    </div>
  );
}
