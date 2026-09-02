import { prisma } from "@/lib/prisma";
import { encryptToken, decryptToken } from "@/lib/crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Add it to .env`);
  return v;
}

export function getGoogleAuthUrl() {
  const params = new URLSearchParams({
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
export async function getSheetValues(accessToken: string, spreadsheetId: string, sheetName: string) {
  const range = encodeURIComponent(`${sheetName}`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Sheet values fetch failed: ${await res.text()}`);
  const data = await res.json();
  const rows: string[][] = data.values ?? [];
  const [headerRow, ...bodyRows] = rows;
  const headers = headerRow ?? [];
  return {
    headers,
    rows: bodyRows.map((r) => headers.map((_, i) => r[i] ?? "")),
  };
}
