import { prisma } from "@/lib/prisma";
import { encryptToken, decryptToken } from "@/lib/crypto";
import { cellToString } from "@/lib/sheet-parse";

// Read/write on sheets: HQ writes lead status changes back to the status
// cells (lib/sheet-writeback.ts). Drive stays read-only (file picker).
const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SCOPES = [
  SHEETS_WRITE_SCOPE,
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Add it to .env`);
  return v;
}

export const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

export function getGoogleAuthUrl(state: string) {
  const params = new URLSearchParams({
    state,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    access_type: "offline", // required to get a refresh_token
    prompt: "consent", // force refresh_token every time, not just the first connect
    scope: SCOPES,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
  }>;
}

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function getGoogleUserEmail(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email as string | null;
}

// A connection made before write-back existed (scope null) or consented
// read-only can't write status back — the admin is asked to reconnect.
export const hasWriteScope = (conn: { scope: string | null } | null) => !!conn?.scope?.split(" ").includes(SHEETS_WRITE_SCOPE);

// There's only ever one row in GoogleAccountConnection — this app uses a
// single Google account (yours) to read every client's sheet, instead of
// each client going through their own OAuth flow.
export async function getAdminGoogleConnection() {
  return prisma.googleAccountConnection.findFirst({ orderBy: { connectedAt: "desc" } });
}

// Returns a valid (auto-refreshed if needed) access token for the single
// connected Google account, persisting the refreshed token back to Postgres.
export async function getValidAccessToken(): Promise<string> {
  const conn = await getAdminGoogleConnection();
  if (!conn) throw new Error("No Google account connected yet");

  const isExpired = conn.expiresAt.getTime() - 60_000 < Date.now(); // refresh 1 min early
  if (!isExpired) return decryptToken(conn.accessToken);

  const refreshToken = decryptToken(conn.refreshToken);
  const refreshed = await refreshAccessToken(refreshToken);

  await prisma.googleAccountConnection.update({
    where: { id: conn.id },
    data: {
      accessToken: encryptToken(refreshed.access_token),
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });

  return refreshed.access_token;
}

// ── Drive: list the connected account's Google Sheets files ─────────
export async function listSpreadsheets(accessToken: string) {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: "files(id,name,modifiedTime,owners/displayName)",
    orderBy: "modifiedTime desc",
    pageSize: "50",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive list failed: ${await res.text()}`);
  const data = await res.json();
  return (data.files ?? []) as { id: string; name: string; modifiedTime: string }[];
}

// ── Sheets: list tab names within a spreadsheet ──────────────────────
export async function listSheetTabs(accessToken: string, spreadsheetId: string) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Sheets metadata fetch failed: ${await res.text()}`);
  const data = await res.json();
  return (data.sheets ?? []).map((s: any) => s.properties.title as string);
}

// ── Sheets: fetch all values from a tab (first row = headers) ────────
// `unformatted` (used by the lead sync) returns raw typed values — numbers
// without currency/locale formatting and dates as Sheets serial numbers —
// in `cells`; `rows` is always the same data as strings. The default
// (formatted) is what a human sees in Sheets, for display-only callers.
export async function getSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  opts: { unformatted?: boolean } = {}
) {
  const range = encodeURIComponent(`${sheetName}`);
  const query = opts.unformatted ? "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER" : "";
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}${query}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Sheet values fetch failed: ${await res.text()}`);
  const data = await res.json();
  const values: unknown[][] = data.values ?? [];
  const [headerRow, ...bodyRows] = values;
  const headers = (headerRow ?? []).map(cellToString); // not trimmed — stored statusColumn names must keep matching
  const cells = bodyRows.map((r) => headers.map((_, i) => r[i] ?? ""));
  return {
    headers,
    rows: cells.map((r) => r.map(cellToString)),
    cells,
  };
}

// ── Sheets: a column's dropdown values (data validation) ─────────────
// Read from the first data row's cell. A list typed into the rule
// (ONE_OF_LIST) is returned as-is; one that points at a range
// (ONE_OF_RANGE, "=Lists!$A$2:$A$20") is read from that range. No rule →
// [] (the column is free text).
export async function getDropdownOptions(accessToken: string, spreadsheetId: string, sheetName: string, colIdx: number): Promise<string[]> {
  const cell = `'${sheetName.replace(/'/g, "''")}'!${columnLetter(colIdx)}2`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?ranges=${encodeURIComponent(cell)}&includeGridData=true&fields=${encodeURIComponent("sheets.data.rowData.values.dataValidation")}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Dropdown read failed: ${await res.text()}`);
  const data = await res.json();
  const condition = data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation?.condition;
  const raw: string[] = (condition?.values ?? []).map((v: { userEnteredValue?: string }) => v.userEnteredValue ?? "").filter(Boolean);
  if (condition?.type === "ONE_OF_LIST") return raw.map((v) => v.trim()).filter(Boolean);
  if (condition?.type === "ONE_OF_RANGE" && raw[0]) {
    const range = raw[0].replace(/^=/, "").replace(/\$/g, "");
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) throw new Error(`Dropdown range read failed: ${await r.text()}`);
    const values: unknown[][] = (await r.json()).values ?? [];
    return values.flat().map(cellToString).map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

// 0 → A, 25 → Z, 26 → AA.
export function columnLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// ── Sheets: write cells (USER_ENTERED, as if typed) ──────────────────
// Returns the HTTP status so the caller can back off on 429.
export async function batchUpdateValues(accessToken: string, spreadsheetId: string, data: { range: string; values: string[][] }[]) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
  });
  return { ok: res.ok, status: res.status, error: res.ok ? null : await res.text() };
}
