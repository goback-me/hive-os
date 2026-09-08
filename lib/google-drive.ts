const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  size?: string;
  parents?: string[];
  webViewLink?: string;
};

const META_FIELDS = "id,name,mimeType,modifiedTime,iconLink,thumbnailLink,size,parents,webViewLink";

const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

// Google Sheets specifically get opened in a real Sheets tab rather than
// exported to PDF through the proxy — a PDF export of a spreadsheet is
// paginated print output, nothing like the actual sheet. This does mean the
// viewer's own Google account needs access to that specific file.
export function nativeOpenUrl(item: Pick<DriveItem, "mimeType" | "id" | "webViewLink">): string | null {
  if (item.mimeType !== SPREADSHEET_MIME) return null;
  return item.webViewLink ?? `https://docs.google.com/spreadsheets/d/${item.id}/edit`;
}

// Pulls the Drive file/folder id and kind out of a pasted Drive/Docs/Sheets/
// Slides URL. Mirrors the regex used client-side in GameplanPanel so both
// agree on what counts as a valid link.
export function parseDriveLink(link: string): { id: string; isFolder: boolean } | null {
  const match = link.match(
    /^https:\/\/(?:drive|docs)\.google\.com\/(file\/d|document\/d|spreadsheets\/d|presentation\/d|drive\/folders)\/([a-zA-Z0-9_-]+)/
  );
  if (!match) return null;
  return { id: match[2], isFolder: match[1] === "drive/folders" };
}

export function isFolder(item: Pick<DriveItem, "mimeType">): boolean {
  return item.mimeType === FOLDER_MIME;
}

export async function getDriveMeta(accessToken: string, id: string): Promise<DriveItem> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=${META_FIELDS}&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Drive metadata fetch failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function listDriveChildren(accessToken: string, folderId: string): Promise<DriveItem[]> {
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed=false`,
    fields: `files(${META_FIELDS})`,
    orderBy: "folder,name",
    pageSize: "200",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive folder list failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return (data.files ?? []) as DriveItem[];
}

// Walks the parent chain up from `targetId`, checking whether `rootId` is an
// ancestor. Used to authorize browsing into subfolders of a client's saved
// Gameplan link without letting anyone fetch an arbitrary Drive id through
// the connected account.
export async function isWithinDriveTree(
  accessToken: string,
  targetId: string,
  rootId: string,
  maxDepth = 8
): Promise<boolean> {
  if (targetId === rootId) return true;
  let frontier = [targetId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      let parents: string[];
      try {
        const meta = await getDriveMeta(accessToken, id);
        parents = meta.parents ?? [];
      } catch {
        continue;
      }
      if (parents.includes(rootId)) return true;
      next.push(...parents);
    }
    frontier = next;
  }
  return false;
}

// Google-native types (Docs/Sheets/Slides/Drawings/...) have no binary
// content of their own — they must be exported to a real format instead of
// downloaded with alt=media.
export function isGoogleNativeType(mimeType: string): boolean {
  return mimeType.startsWith("application/vnd.google-apps.") && mimeType !== FOLDER_MIME;
}

export async function fetchDriveFileContent(accessToken: string, item: DriveItem): Promise<Response> {
  const url = isGoogleNativeType(item.mimeType)
    ? `https://www.googleapis.com/drive/v3/files/${item.id}/export?mimeType=${encodeURIComponent("application/pdf")}`
    : `https://www.googleapis.com/drive/v3/files/${item.id}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Drive file fetch failed (${res.status}): ${await res.text()}`);
  return res;
}
