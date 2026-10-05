import { prisma } from "./prisma";
import { getReportingScope } from "./reporting-scope";
import { getAdminGoogleConnection, getValidAccessToken } from "./google-sheets";
import { getMetaTokenInfo } from "./meta-ads";
import { overdueLeads } from "./reminders";
import { syncAlertTasks } from "./clickup";
import { DATE_OPT_IN_KEYWORDS, findColumn, findHeaderIndex } from "./sheet-parse";
import type { AlertSeverity, DataAlertType } from "@prisma/client";
import type { Diff } from "./reconcile";

// Data health: everything that would make a client's numbers wrong or stale,
// checked after every sync (lib/lead-sync.ts), by the cron for clients
// without a sheet, and on a coach's "Re-check". Each problem is a DataAlert
// with a plain-English title, a fix hint and a link to where it's fixed.
// A problem no longer found → RESOLVED. A coach's "Mark handled" → DISMISSED,
// which stays quiet unless the problem grows (count goes up).

type Finding = {
  type: DataAlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
  fixHint: string;
  fixUrl: string | null;
  count?: number;
  affectedLeadIds?: string[];
  fingerprint?: string;
};

// Report-breaking problems: while one is open, a CLIENT's reports show
// "Data being updated" instead of numbers (lib/report-hold.ts).
export const HOLD_TYPES: DataAlertType[] = ["RECONCILE_MISMATCH", "STATUS_COLUMN_MISSING"];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const noCampaign = (c: string | null) => !c || !c.trim() || c.trim() === "-" || c.includes("{{");

export async function runHealthChecks(clientId: string, now = new Date()) {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { slug: true, startDate: true, archivedAt: true, metaAdAccountId: true, metaAccessToken: true, clientSheet: true },
  });
  if (!client) return [];
  const sheet = client.clientSheet;
  const base = `/clients/${client.slug}`;
  const url = { leads: `${base}?tab=leads`, ads: `${base}?tab=ads`, dashboard: `${base}?tab=dashboard`, sheet: `/leads?client=${client.slug}` };
  const f: Finding[] = [];

  // ── Setup ──
  if (!client.startDate) {
    f.push({ type: "NO_START_DATE", severity: "WARNING", title: "No start date set", detail: "Reports include everything ever recorded, including leads and spend from before Hive started.", fixHint: "Set the client's start date on Client Details.", fixUrl: url.dashboard });
  }
  const scope = await getReportingScope(clientId);
  if (scope.campaigns.length && !scope.includedCampaignIds.length) {
    f.push({ type: "NO_INCLUDED_CAMPAIGNS", severity: "WARNING", title: "No campaigns counted in reports", detail: `None of the ${plural(scope.campaigns.length, "campaign")} are ticked, so spend and cost metrics show $0.`, fixHint: "Tick the campaigns Hive runs under Ads → Campaigns in reports.", fixUrl: url.ads });
  }
  if (client.metaAdAccountId && client.metaAccessToken) {
    const info = await getMetaTokenInfo(client.metaAccessToken).catch(() => null); // can't check right now ≠ broken
    if (info && !info.valid) {
      f.push({ type: "META_TOKEN_EXPIRED", severity: "DANGER", title: "Meta connection has stopped working", detail: info.error ?? "Meta says the access token is no longer valid — ad spend can't be read.", fixHint: "Reconnect Meta on the Ads tab with a fresh token.", fixUrl: url.ads, fingerprint: "expired" });
    } else if (info?.expiresAt && new Date(info.expiresAt).getTime() - now.getTime() < 7 * DAY) {
      f.push({ type: "META_TOKEN_EXPIRED", severity: "WARNING", title: "Meta connection expires soon", detail: `The Meta access token expires ${new Date(info.expiresAt).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" })}.`, fixHint: "Reconnect Meta on the Ads tab before then.", fixUrl: url.ads, fingerprint: "expiring" });
    }
  }

  // ── Sheet + sync ──
  if (sheet) {
    const conn = await getAdminGoogleConnection();
    const googleError = !conn ? "No Google account is connected." : await getValidAccessToken().then(() => null, (e: unknown) => (e instanceof Error ? e.message : "Token refresh failed"));
    if (googleError) {
      f.push({ type: "GOOGLE_TOKEN_INVALID", severity: "DANGER", title: "Google connection isn't working", detail: `${googleError.slice(0, 300)} Leads can't sync from the sheet.`, fixHint: "An admin reconnects Google on the Leads page.", fixUrl: url.sheet });
    }

    const missingStatus = [sheet.statusColumn, sheet.resultStatusColumn].filter((c): c is string => !!c && findHeaderIndex(sheet.allColumns, c) === -1);
    if (!sheet.statusColumn && !sheet.resultStatusColumn) {
      f.push({ type: "STATUS_COLUMN_MISSING", severity: "DANGER", title: "No status column chosen", detail: "Without HIVE STATUS / Prospect Status every lead sits at Chase Up.", fixHint: "Pick the status columns in the sheet settings.", fixUrl: url.sheet, fingerprint: "none" });
    } else if (missingStatus.length) {
      f.push({ type: "STATUS_COLUMN_MISSING", severity: "DANGER", title: `Status column "${missingStatus[0]}" not found in the sheet`, detail: "It was renamed or deleted, so syncing has stopped.", fixHint: "Rename it back in the sheet, or pick the new column in the sheet settings.", fixUrl: url.sheet, fingerprint: missingStatus.join("|") });
    }
    const cols = sheet.allColumns;
    if (findColumn(cols, ["name", "full name"], ["campaign", "ad", "adset", "ad set", "business"]) === -1 && findColumn(cols, ["phone"]) === -1 && findColumn(cols, ["email"]) === -1) {
      f.push({ type: "REQUIRED_COLUMN_MISSING", severity: "DANGER", title: "No name, phone or email column", detail: "Leads can't be told apart, so none can sync.", fixHint: "Add (or rename) a Name, Phone or Email column in the sheet.", fixUrl: url.sheet, fingerprint: "identity" });
    }
    if (findColumn(cols, DATE_OPT_IN_KEYWORDS) === -1) {
      f.push({ type: "REQUIRED_COLUMN_MISSING", severity: "WARNING", title: "No opt-in date column", detail: "Leads are dated by when they first synced, so monthly numbers are off.", fixHint: 'Add a "Date Opt In" column to the sheet.', fixUrl: url.sheet, fingerprint: "optin" });
    }
    if (findColumn(cols, ["campaign"]) === -1) {
      f.push({ type: "REQUIRED_COLUMN_MISSING", severity: "WARNING", title: "No campaign column", detail: "Leads can't be credited to campaigns, so per-campaign costs are blank.", fixHint: 'Add a "Campaign" column to the sheet.', fixUrl: url.sheet, fingerprint: "campaign" });
    }

    const err = sheet.lastSyncError;
    if (err?.startsWith("Sync aborted")) {
      f.push({ type: "SYNC_ABORTED_GUARD", severity: "DANGER", title: "Sync stopped to protect leads", detail: err, fixHint: "Check the sheet tab hasn't been emptied, filtered or swapped, then sync again.", fixUrl: url.sheet });
    } else if (err) {
      f.push({ type: "SYNC_FAILED", severity: "DANGER", title: "Sync is failing", detail: err.slice(0, 300), fixHint: "Fix what the error says, then press Sync now on the Leads tab.", fixUrl: url.leads });
    }
    if (!sheet.lastSyncedAt || now.getTime() - sheet.lastSyncedAt.getTime() > HOUR) {
      f.push({ type: "SYNC_STALE", severity: "WARNING", title: "Leads haven't synced in over an hour", detail: sheet.lastSyncedAt ? `Last successful sync ${sheet.lastSyncedAt.toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}.` : "This sheet has never synced.", fixHint: "Check the VPS cron (every 5 min, DEPLOYMENT.md) is running, or press Sync now.", fixUrl: url.leads });
    }

    const unmapped = (sheet.unmappedStatuses ?? { status: {}, result: {} }) as { status: Record<string, number>; result: Record<string, number> };
    const values = [...Object.entries(unmapped.status ?? {}), ...Object.entries(unmapped.result ?? {})];
    if (values.length) {
      const rows = values.reduce((s, [, n]) => s + n, 0);
      f.push({ type: "UNMAPPED_STATUS", severity: "WARNING", title: `${plural(values.length, "status value")} not recognised`, detail: `${values.slice(0, 6).map(([v, n]) => `"${v}" (${n})`).join(", ")}${values.length > 6 ? "…" : ""} — ${plural(rows, "row")} counted as Chase Up.`, fixHint: "Map each value to a stage in the sheet settings.", fixUrl: url.sheet, count: rows });
    }

    const latest = await prisma.syncReconciliation.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" } });
    if (latest && !latest.ok) {
      const diffs = latest.diffs as Diff[];
      f.push({ type: "RECONCILE_MISMATCH", severity: "DANGER", title: "Sheet and HQ don't match", detail: diffs.slice(0, 8).map((d) => `${d.metric}: sheet ${d.sheet}, HQ ${d.hq}`).join("\n"), fixHint: "Usually duplicate rows (same email/phone/name) or a renamed status — fix the sheet, then sync. Client reports are paused until this clears.", fixUrl: url.sheet, count: diffs.length });
    }
    const badOptIn = ((latest?.sheetCounts as { badOptInLeadIds?: string[] } | null)?.badOptInLeadIds ?? []).filter(Boolean);
    if (badOptIn.length) {
      f.push({ type: "BAD_OPTIN_DATE", severity: "WARNING", title: `${plural(badOptIn.length, "lead")} with a missing or unreadable opt-in date`, detail: "They're dated by when they first synced instead. Dates must be day/month/year.", fixHint: "Fill in the Date Opt In cells as dd/mm/yyyy.", fixUrl: url.leads, count: badOptIn.length, affectedLeadIds: badOptIn.slice(0, 200) });
    }
  }

  // ── Lead data (since the start date) ──
  const leads = await prisma.lead.findMany({
    where: { clientId, deletedAt: null, ...(client.startDate ? { createdAt: { gte: client.startDate } } : {}) },
    select: { id: true, stage: true, value: true, dqReason: true, lostReason: true, campaign: true, sheetWriteError: true },
  });
  const leadCheck = (type: DataAlertType, severity: AlertSeverity, ids: string[], title: (n: number) => string, detail: string, fixHint: string, fixUrl = url.leads) => {
    if (ids.length) f.push({ type, severity, title: title(ids.length), detail, fixHint, fixUrl, count: ids.length, affectedLeadIds: ids.slice(0, 200) });
  };
  const ids = (pred: (l: (typeof leads)[number]) => boolean) => leads.filter(pred).map((l) => l.id);
  leadCheck("WON_NO_VALUE", "DANGER", ids((l) => l.stage === "WON" && l.value == null), (n) => `${plural(n, "won lead")} with no job value`, "Their revenue counts as $0.", "Leads tab → Needs fixing — add each job value.");
  leadCheck("QUOTE_NO_VALUE", "WARNING", ids((l) => l.stage === "QUOTE_SENT" && l.value == null), (n) => `${plural(n, "quoted lead")} with no quote value`, "Quote value totals are understated.", "Leads tab → Needs fixing — add each quote value.");
  leadCheck("DQ_NO_REASON", "WARNING", ids((l) => l.stage === "DISQUALIFIED" && (!l.dqReason || l.dqReason === "UNKNOWN")), (n) => `${plural(n, "disqualified lead")} with no reason`, "The DQ-by-reason breakdown can't explain them.", "Leads tab → Needs fixing — pick a reason for each.");
  leadCheck("LOST_NO_REASON", "WARNING", ids((l) => l.stage === "LOST" && (!l.lostReason || l.lostReason === "UNKNOWN")), (n) => `${plural(n, "lost lead")} with no reason`, "Lost-by-reason can't explain them.", "Leads tab → Needs fixing — pick a reason for each.");
  leadCheck("LEAD_NO_CAMPAIGN", "WARNING", ids((l) => noCampaign(l.campaign)), (n) => `${plural(n, "lead")} with no campaign`, "They show as Unattributed, so campaign costs can't include them.", "Fill in the Campaign column in the sheet.", url.sheet);
  const writeFails = leads.filter((l) => l.sheetWriteError);
  leadCheck("WRITEBACK_FAILED", "WARNING", writeFails.map((l) => l.id), (n) => `${plural(n, "status change")} not written to the sheet`, writeFails[0]?.sheetWriteError ?? "", "Fix what the error says (often: reconnect Google or add the missing dropdown option), then change the status again.");
  leadCheck("CLIENT_UPDATE_OVERDUE", "WARNING", (await overdueLeads(clientId, now)).map((l) => l.id), (n) => `${plural(n, "lead")} overdue for the client's update`, "Handed over 7+ days ago with no update, or sitting in a stage twice as long as this client usually takes.", "Chase the client to update them (Dashboard → Update your leads).", url.dashboard);

  if (scope.source === "meta") {
    const known = new Set(scope.campaigns.map((c) => c.name.toLowerCase().trim()));
    const unmatched = leads.filter((l) => !noCampaign(l.campaign) && !known.has(l.campaign!.toLowerCase().trim()));
    const names = Array.from(new Set(unmatched.map((l) => l.campaign!.trim())));
    if (unmatched.length) {
      f.push({ type: "CAMPAIGN_NAME_UNMATCHED", severity: "WARNING", title: `${plural(names.length, "campaign name")} in the sheet not found in Meta`, detail: `${names.slice(0, 5).map((n) => `"${n}"`).join(", ")}${names.length > 5 ? "…" : ""} — ${plural(unmatched.length, "lead")} can't be matched to spend.`, fixHint: "Make the sheet's campaign names match Meta exactly (or check the ad's URL tags).", fixUrl: url.ads, count: unmatched.length, affectedLeadIds: unmatched.map((l) => l.id).slice(0, 200) });
    }
  }

  // ── Integrations (failures never block anything — they show up here) ──
  const [slackFails, clickupFails] = await Promise.all([
    prisma.slackPostLog.findMany({ where: { clientId, status: "FAILED", createdAt: { gt: new Date(now.getTime() - DAY) } }, select: { error: true, kind: true } }),
    prisma.clickUpTaskLog.findMany({ where: { clientId, status: "FAILED" }, select: { error: true, title: true } }),
  ]);
  if (slackFails.length) {
    f.push({ type: "SLACK_FAILED", severity: "WARNING", title: `${plural(slackFails.length, "Slack post")} failed`, detail: slackFails[0].error ?? "", fixHint: 'Check the channel ID in Client Details → Integrations, invite the Hive bot to the channel, and "Send test message".', fixUrl: url.dashboard, count: slackFails.length });
  }
  if (clickupFails.length) {
    f.push({ type: "CLICKUP_FAILED", severity: "WARNING", title: `${plural(clickupFails.length, "ClickUp task")} couldn't be created or closed`, detail: `${clickupFails[0].title}: ${clickupFails[0].error ?? ""}`, fixHint: "Check the ClickUp API key under Settings → Integrations and the client's ClickUp list.", fixUrl: url.dashboard, count: clickupFails.length });
  }

  await saveFindings(clientId, f, now);
  // A ClickUp task per serious problem / overdue client updates; closed when resolved.
  await syncAlertTasks(clientId).catch((e) => console.error("ClickUp alert tasks failed:", e));
  return f;
}

// One row per (client, type, fingerprint). Found again → refreshed (and
// reopened if it had been resolved, or had grown since being dismissed);
// not found → resolved.
async function saveFindings(clientId: string, findings: Finding[], now: Date) {
  const existing = await prisma.dataAlert.findMany({ where: { clientId } });
  const key = (type: string, fp: string) => `${type}|${fp}`;
  const byKey = new Map(existing.map((a) => [key(a.type, a.fingerprint), a]));
  const seen = new Set<string>();

  for (const x of findings) {
    const fingerprint = x.fingerprint ?? "";
    const k = key(x.type, fingerprint);
    seen.add(k);
    const prev = byKey.get(k);
    const count = x.count ?? 1;
    const data = { severity: x.severity, title: x.title, detail: x.detail, fixHint: x.fixHint, fixUrl: x.fixUrl, count, affectedLeadIds: x.affectedLeadIds ?? [], lastSeenAt: now };
    if (!prev) {
      await prisma.dataAlert.create({ data: { clientId, type: x.type, fingerprint, ...data, firstSeenAt: now } });
      continue;
    }
    const reopen = prev.status === "RESOLVED" || (prev.status === "DISMISSED" && count > prev.count);
    await prisma.dataAlert.update({
      where: { id: prev.id },
      data: { ...data, ...(reopen ? { status: "OPEN", resolvedAt: null, dismissNote: null, ...(prev.status === "RESOLVED" ? { firstSeenAt: now } : {}) } : {}) },
    });
  }
  const gone = existing.filter((a) => a.status !== "RESOLVED" && !seen.has(key(a.type, a.fingerprint)));
  if (gone.length) await prisma.dataAlert.updateMany({ where: { id: { in: gone.map((a) => a.id) } }, data: { status: "RESOLVED", resolvedAt: now } });
}
