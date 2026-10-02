import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAdminGoogleConnection, getDropdownOptions, getValidAccessToken, getSheetValues, hasWriteScope } from "@/lib/google-sheets";
import { automationWrites, queueWrites, type CellWrite } from "@/lib/sheet-writeback";
import { countValues, reconcile, type SideCounts } from "@/lib/reconcile";
import { runHealthChecks } from "@/lib/data-health";
import { clampRange, getReportingScope, scopedSpend } from "@/lib/reporting-scope";
import { classifyHive, classifyProspect, isPendingUpdate, parseMapping, resolveStatus } from "@/lib/status-classifier";
import { NOTES_KEYWORDS, parseNotes, type ParsedNote } from "@/lib/notes-parser";
import { classifyNotesWithAI } from "@/lib/notes-ai";
import { milestoneSql } from "@/lib/milestones";
import {
  HANDOVER_STAGES,
  awaitingClientUpdate,
  combineTargets,
  parseTarget,
  planStageEvents,
  type DqPhaseValue,
  type LeadStageValue,
  type PlannedEvent,
  type StageTarget,
} from "@/lib/lead-status";
import {
  DATE_OPT_IN_KEYWORDS,
  detectStatusColumns,
  findColumn,
  findHeaderIndex,
  formatSheetDate,
  normalizeEmail,
  normalizeHeader,
  normalizeName,
  normalizePhone,
  parseSheetDate,
} from "@/lib/sheet-parse";
import {
  DURATION_KEYS,
  addLead,
  costPer,
  emptyCounts,
  funnelRates,
  type Durations,
  type FunnelCounts,
  type FunnelGroup,
  type FunnelLead,
} from "@/lib/funnel";

export type UnmappedStatuses = { status: Record<string, number>; result: Record<string, number> };

function parseMoney(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// total = sheet rows, leads = rows with an identity; updated only counts leads that actually changed.
export type SyncSummary = { total: number; leads: number; created: number; updated: number; removed: number; restored: number };

// Soft-deletes every synced lead for a client — used when the client's sheet
// is changed or removed, so leads from a sheet that's no longer assigned never
// show alongside the new one. Notes/history stay, and a lead is restored if
// its row turns up again.
export async function clearClientLeads(clientId: string) {
  await prisma.lead.updateMany({ where: { clientId, deletedAt: null }, data: { deletedAt: new Date() } });
}

// Pulls the client's assigned sheet and upserts each row into the Lead table.
// Status is two-way: where HQ changed a lead's stage more recently than the
// sheet did, HQ's stage stands (its write-back updates the sheet). Every
// other field refreshes from the sheet. Then the status automation's missing
// cells are queued for write-back. The outcome (time or error) is recorded on
// ClientSheet so the Leads tab can show it.
export async function syncLeadsFromSheet(clientId: string): Promise<SyncSummary> {
  let sheet = await prisma.clientSheet.findUnique({ where: { clientId } });
  if (!sheet) throw new Error("No Google Sheet assigned to this client yet — connect one on the Leads page first.");

  // No status column picked yet → every lead would sit on one stage. Pick
  // the obvious ones ("HIVE STATUS" / "Prospect Status") and save them, so
  // they also show up selected on the Leads page.
  if (!sheet.statusColumn && !sheet.resultStatusColumn) {
    const detected = detectStatusColumns(sheet.allColumns);
    if (detected.statusColumn || detected.resultStatusColumn) {
      sheet = await prisma.clientSheet.update({ where: { clientId }, data: detected });
    }
  }

  try {
    sheet = await refreshDropdownOptions(sheet);
    const { summary, unmapped, automation, recon } = await runSync(clientId, sheet);
    await prisma.clientSheet.update({
      where: { clientId },
      data: { lastSyncedAt: new Date(), lastSyncError: null, unmappedStatuses: unmapped },
    });
    // Only once Google can write — otherwise every sync would queue jobs
    // doomed to fail (the admin sees a reconnect banner instead).
    if (automation.length && hasWriteScope(await getAdminGoogleConnection())) {
      for (const a of automation) await queueWrites(clientId, a.leadId, a.writes);
    }
    await saveReconciliation(clientId, recon);
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.clientSheet.update({ where: { clientId }, data: { lastSyncError: message.slice(0, 500) } }).catch(() => {});
    throw err;
  } finally {
    // Data health after every sync, pass or fail (lib/data-health.ts).
    await runHealthChecks(clientId).catch((e) => console.error("Health checks failed:", e));
  }
}

type ReconInput = { sheet: SideCounts; seenIds: string[]; badOptInLeadIds: string[] };

// Raw sheet vs what HQ now holds (lib/reconcile.ts), saved per sync — the
// last 50 are kept. Leads with a newer HQ change are left out of "won" on
// both sides (the sheet catches up via write-back).
async function saveReconciliation(clientId: string, recon: ReconInput) {
  const leads = await prisma.lead.findMany({
    where: { clientId, deletedAt: null, externalKey: { not: null } },
    select: { id: true, hiveStatusRaw: true, prospectStatusRaw: true, sheetStage: true, value: true, hqStatusUpdatedAt: true, sheetStatusUpdatedAt: true },
  });
  const hqNewer = (l: (typeof leads)[number]) => !!l.hqStatusUpdatedAt && (!l.sheetStatusUpdatedAt || l.hqStatusUpdatedAt > l.sheetStatusUpdatedAt);
  const won = leads.filter((l) => l.sheetStage === "WON" && !hqNewer(l));
  const seen = new Set(recon.seenIds);
  const hq: SideCounts = {
    rows: leads.length,
    hive: countValues(leads.map((l) => l.hiveStatusRaw)),
    prospect: countValues(leads.map((l) => l.prospectStatusRaw)),
    won: won.length,
    wonValue: won.reduce((s, l) => s + Number(l.value ?? 0), 0),
    unmatched: leads.filter((l) => !seen.has(l.id)).length,
  };
  const diffs = reconcile(recon.sheet, hq);
  await prisma.syncReconciliation.create({
    data: { clientId, sheetCounts: { ...recon.sheet, badOptInLeadIds: recon.badOptInLeadIds }, hqCounts: hq, diffs, ok: diffs.length === 0 },
  });
  const old = await prisma.syncReconciliation.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, skip: 50, select: { id: true } });
  if (old.length) await prisma.syncReconciliation.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

type Sheet = NonNullable<Awaited<ReturnType<typeof prisma.clientSheet.findUnique>>>;

// Each status column's dropdown values, re-read every sync — write-back only
// ever writes one of these. A read failure keeps the last known list.
async function refreshDropdownOptions(sheet: Sheet): Promise<Sheet> {
  try {
    const token = await getValidAccessToken();
    const options = async (column: string | null) => {
      const idx = findHeaderIndex(sheet.allColumns, column);
      return idx === -1 ? [] : getDropdownOptions(token, sheet.spreadsheetId, sheet.sheetName, idx);
    };
    const [statusOptions, resultStatusOptions] = await Promise.all([options(sheet.statusColumn), options(sheet.resultStatusColumn)]);
    const same = JSON.stringify([statusOptions, resultStatusOptions]) === JSON.stringify([sheet.statusOptions, sheet.resultStatusOptions]);
    if (same) return sheet;
    return prisma.clientSheet.update({ where: { clientId: sheet.clientId }, data: { statusOptions, resultStatusOptions } });
  } catch (err) {
    console.error("Dropdown options refresh failed — keeping the last known values:", err);
    return sheet;
  }
}

const CHUNK = 200;
function chunks<T>(arr: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

type ExistingLead = Awaited<ReturnType<typeof prisma.lead.findMany>>[number];

// Nothing to write if every synced field already matches — keeps a 5-minute
// cron from rewriting thousands of identical rows.
function leadChanged(existing: ExistingLead, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    const cur = (existing as Record<string, unknown>)[k];
    if (k === "raw") {
      // Postgres jsonb stores keys in its own order, so compare key-by-key —
      // a string compare saw every lead as changed on every sync.
      const a = (cur ?? {}) as Record<string, unknown>;
      const b = (v ?? {}) as Record<string, unknown>;
      if (Object.keys(a).length !== Object.keys(b).length || Object.keys(b).some((key) => a[key] !== b[key])) return true;
    } else if (k === "value") {
      if ((cur == null ? null : Number(cur)) !== (v == null ? null : Number(v))) return true;
    } else if (cur instanceof Date || v instanceof Date) {
      if ((cur as Date | null)?.getTime() !== (v as Date | null)?.getTime()) return true;
    } else if ((cur ?? null) !== (v ?? null)) return true;
  }
  return false;
}

// A notes cell that changed since the last sync and has been re-parsed.
type NoteJob = { hash: string; notes: (ParsedNote & { source?: "REGEX" | "AI" })[] };

type PendingUpdate = {
  lead: ExistingLead;
  data: Record<string, unknown>;
  stageFrom?: LeadStageValue;
  stageTo?: LeadStageValue;
  overrodeHq?: boolean; // the sheet's change beat an earlier HQ change
  overridden?: LeadStageValue; // the sheet said this, but a newer HQ change won
  value: number | null;
  events: PlannedEvent[];
  noteJob?: NoteJob;
};

type StageEventRow = { id: string; leadId: string; stage: LeadStageValue; at: Date; source: "SYNC" | "IMPORT" | "INFERRED" };

// Planned events → rows. A brand-new lead's stages are IMPORT (we don't know
// when they happened); a change seen on an existing lead is SYNC.
function eventRows(leadId: string, planned: PlannedEvent[], isNew: boolean, at: Date): StageEventRow[] {
  return planned.map((e) => ({
    id: randomUUID(),
    leadId,
    stage: e.stage,
    at,
    source: e.kind === "inferred" ? "INFERRED" : isNew ? "IMPORT" : "SYNC",
  }));
}

function reasonFields(target: StageTarget & { stage: LeadStageValue }, dqPhase: DqPhaseValue | null) {
  return {
    dqReason: target.stage === "DISQUALIFIED" ? target.dqReason ?? "UNKNOWN" : null,
    dqPhase: target.stage === "DISQUALIFIED" ? dqPhase : null,
    lostReason: target.stage === "LOST" ? target.lostReason ?? "UNKNOWN" : null,
  };
}

async function runSync(
  clientId: string,
  sheet: Sheet
): Promise<{ summary: SyncSummary; unmapped: UnmappedStatuses; automation: { leadId: string; writes: CellWrite[] }[]; recon: ReconInput }> {
  const accessToken = await getValidAccessToken();
  const { headers, rows, cells } = await getSheetValues(accessToken, sheet.spreadsheetId, sheet.sheetName, { unformatted: true });

  // Client's own mapping first, then the keyword classifier (resolveStatus).
  const statusMapping = parseMapping(sheet.statusMapping);
  const statusColIdx = findHeaderIndex(headers, sheet.statusColumn);
  const resultStatusMapping = parseMapping(sheet.resultStatusMapping);
  const resultStatusColIdx = findHeaderIndex(headers, sheet.resultStatusColumn);

  // A configured status column that's missing from the sheet would quietly
  // turn every lead into the fallback stage — stop instead and say why.
  for (const [name, idx] of [[sheet.statusColumn, statusColIdx], [sheet.resultStatusColumn, resultStatusColIdx]] as const) {
    if (name && idx === -1) throw new Error(`Status column '${name}' not found in sheet`);
  }

  const nameIdx = findColumn(headers, ["name", "full name"], ["campaign", "ad", "adset", "ad set", "business"]);
  const phoneIdx = findColumn(headers, ["phone"]);
  const emailIdx = findColumn(headers, ["email"]);
  const sourceIdx = findColumn(headers, ["source"], ["utm"]);
  const campaignIdx = findColumn(headers, ["campaign"]);
  const adsetIdx = findColumn(headers, ["adset", "ad set"]);
  const revenueIdx = findColumn(headers, ["revenue generated", "revenue"]);
  const quoteIdx = findColumn(headers, ["quote value", "quote"]);
  const dateOptInIdx = findColumn(headers, DATE_OPT_IN_KEYWORDS);
  const attemptsIdx = findColumn(headers, ["attempt"]);
  const notesIdx = findColumn(headers, NOTES_KEYWORDS);
  // Other date-ish columns only go into `raw` for display — turn serials
  // back into dd/mm/yyyy so they don't show as "46000.5".
  const dateLikeIdx = new Set(headers.map((h, i) => (normalizeHeader(h).split(" ").includes("date") ? i : -1)).filter((i) => i !== -1));
  const unmapped: UnmappedStatuses = { status: {}, result: {} };

  // Every lead this client has ever had from a sheet, soft-deleted included —
  // a row that reappears restores its old lead (notes + history intact)
  // instead of creating a duplicate.
  const [existingLeads, existingEvents] = await Promise.all([
    prisma.lead.findMany({ where: { clientId, externalKey: { not: null } } }),
    prisma.leadStageEvent.findMany({ where: { lead: { clientId } }, select: { leadId: true, stage: true } }),
  ]);
  const eventStagesByLead = new Map<string, Set<LeadStageValue>>();
  for (const e of existingEvents) {
    if (!eventStagesByLead.has(e.leadId)) eventStagesByLead.set(e.leadId, new Set());
    eventStagesByLead.get(e.leadId)!.add(e.stage);
  }

  const byEmail = new Map<string, ExistingLead>();
  const byPhone = new Map<string, ExistingLead>();
  const byName = new Map<string, ExistingLead>();
  // Soft-deleted first so an active lead with the same identity overwrites it.
  const ordered = [...existingLeads].sort((a, b) => Number(!!b.deletedAt) - Number(!!a.deletedAt));
  for (const l of ordered) {
    const e = normalizeEmail(l.email);
    const p = normalizePhone(l.phone);
    const n = normalizeName(l.name);
    if (e) byEmail.set(e, l);
    if (p) byPhone.set(p, l);
    if (n) byName.set(n, l);
  }

  // Match order: email, then phone, then name. A lead already matched by one
  // row can't be claimed by a different row via the weaker phone/name
  // fallback; a duplicate row with the same email still lands on the same lead.
  // ponytail: the name-only fallback can merge two different people with the
  // same name when neither has a matching email/phone. Fine at our volumes.
  const claimed = new Map<string, number>(); // leadId -> row index that claimed it
  const pending = new Map<string, PendingUpdate>();
  const automation: { key: string; writes: CellWrite[] }[] = []; // key = lead id, or externalKey for a new lead
  // For reconciliation: every identified row as the sheet has it.
  const sheetRows: { hive: string; prospect: string; won: boolean; value: number | null }[] = [];
  const badOptIn: string[] = []; // lead id, or externalKey for a new lead
  const creates = new Map<string, { data: Record<string, unknown>; events: PlannedEvent[]; noteJob?: NoteJob }>(); // externalKey -> new lead
  let identifiedRows = 0;

  rows.forEach((row, rowIdx) => {
    const name = nameIdx !== -1 ? row[nameIdx].trim() : "";
    // A mobile stored as a number comes back without its leading 0.
    const phoneText = phoneIdx !== -1 ? row[phoneIdx].trim() : "";
    const phone = /^4\d{8}$/.test(phoneText) ? "0" + phoneText : phoneText;
    const email = emailIdx !== -1 ? row[emailIdx].trim() : "";
    // Every row needs SOME identity to match across syncs — skip fully blank rows.
    if (!(email || phone || name)) return;
    identifiedRows++;
    const externalKey = normalizeName(`${email}|${phone}|${name}`);

    const e = normalizeEmail(email);
    const p = normalizePhone(phone);
    const n = normalizeName(name);
    const free = (l: ExistingLead | undefined) => (l && (!claimed.has(l.id) || claimed.get(l.id) === rowIdx) ? l : undefined);
    const existing = (e && byEmail.get(e)) || free(p ? byPhone.get(p) : undefined) || free(n ? byName.get(n) : undefined) || undefined;

    // Hive/outreach column + Prospect/result column → one stage (the
    // higher-ranked wins, see combineTargets). Values nothing recognises are
    // reported back to the Leads tab instead of being silently guessed.
    const rawStatus = statusColIdx !== -1 ? row[statusColIdx] ?? "" : "";
    const statusTarget = statusColIdx !== -1 ? resolveStatus(rawStatus, statusMapping, unmapped.status, classifyHive) : undefined;
    const rawResultStatus = resultStatusColIdx !== -1 ? row[resultStatusColIdx] ?? "" : "";
    const resultTarget = resultStatusColIdx !== -1 ? resolveStatus(rawResultStatus, resultStatusMapping, unmapped.result, classifyProspect) : undefined;

    // Nothing in either column = the default entry stage, Chase Up.
    const { final, prior } = combineTargets(statusTarget, resultTarget, "CHASE_UP");

    // Two-way sync: the latest change wins. A sheet edit = either status
    // cell's text differs from last sync (not just how our rules read it —
    // a rule change isn't an edit). The sheet gives no edit times, so an edit
    // counts as made at the earliest it could have been: the previous sync.
    // An HQ change after that wins (its write-back will overwrite the sheet);
    // otherwise the sheet does. A lead whose cells were never recorded gets a
    // baseline (epoch) — an earlier HQ change keeps winning until a real edit.
    const rawKnown = !!existing?.sheetStatusUpdatedAt;
    const sheetChanged =
      rawKnown && ((existing!.hiveStatusRaw ?? "") !== rawStatus.trim() || (existing!.prospectStatusRaw ?? "") !== rawResultStatus.trim());
    const sheetTime = !existing || !rawKnown ? new Date(0) : sheetChanged ? existing.lastSyncedAt ?? new Date(0) : existing.sheetStatusUpdatedAt;
    const hqWins = !!existing?.hqStatusUpdatedAt && (!sheetTime || existing.hqStatusUpdatedAt > sheetTime);

    // Status automation: fill in what's missing in the two status cells.
    automation.push({ key: existing?.id ?? externalKey, writes: automationWrites({ raw: rawStatus, stage: statusTarget?.stage ?? null }, rawResultStatus, sheet) });

    // Does the client owe us an update (lib/lead-status.ts)? When HQ's change
    // wins, that's the stage the lead is actually at.
    const awaitingClient = awaitingClientUpdate({
      stage: hqWins ? existing!.stage : final.stage,
      hive: statusTarget,
      prospect: resultTarget,
      prospectPending: resultStatusColIdx !== -1 && isPendingUpdate(rawResultStatus),
    });

    // The deal's value is stored whatever the stage, so quoted leads show
    // their quote. It only counts as REVENUE once the lead is Won — that
    // filter lives in lib/revenue.ts. Quote Value takes priority over
    // Revenue Generated when both are set.
    const value = parseMoney(quoteIdx !== -1 ? row[quoteIdx] : undefined) ?? parseMoney(revenueIdx !== -1 ? row[revenueIdx] : undefined);

    // The real-world date this lead came in — NOT when our app happened to
    // sync it. Without this, a bulk first-time sync of months-old leads
    // would stamp every single one with today's date, silently corrupting
    // month-attribution, the activity timeline, and time-to-convert. Only
    // set when the sheet actually has a parseable value — never invent one.
    const dateOptIn = dateOptInIdx !== -1 ? parseSheetDate(cells[rowIdx][dateOptInIdx]) : null;
    if (dateOptInIdx !== -1 && !dateOptIn) badOptIn.push(existing?.id ?? externalKey);
    sheetRows.push({ hive: rawStatus, prospect: rawResultStatus, won: final.stage === "WON" && !hqWins, value });
    const attempts = attemptsIdx !== -1 ? parseInt(row[attemptsIdx], 10) : NaN;

    // Feedback/notes cell → dated events, only when the cell changed since the
    // last parse (hash) — keeps the AI step to genuinely new text.
    let noteJob: NoteJob | undefined;
    if (notesIdx !== -1) {
      const cell = row[notesIdx] ?? "";
      const hash = createHash("sha256").update(cell).digest("hex");
      if (!existing || existing.notesHash !== hash) {
        noteJob = { hash, notes: parseNotes(cell, dateOptIn ?? existing?.createdAt ?? new Date()) };
      }
    }

    // Everything else — every header not otherwise mapped — goes into `raw`
    // for display only, keyed by its actual header text.
    const mappedIdx = new Set([nameIdx, phoneIdx, emailIdx, sourceIdx, campaignIdx, adsetIdx, revenueIdx, quoteIdx, statusColIdx, resultStatusColIdx, dateOptInIdx, attemptsIdx]);
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (mappedIdx.has(i) || !h) return;
      const cell = cells[rowIdx][i];
      const asDate = dateLikeIdx.has(i) && typeof cell === "number" ? parseSheetDate(cell) : null;
      raw[h] = asDate ? formatSheetDate(asDate) : row[i] ?? "";
    });

    const baseData: Record<string, unknown> = {
      externalKey,
      sheetStage: final.stage,
      name: name || null,
      phone: phone || null,
      email: email || null,
      source: sourceIdx !== -1 ? row[sourceIdx] || null : null,
      campaign: campaignIdx !== -1 ? row[campaignIdx] || null : null,
      adset: adsetIdx !== -1 ? row[adsetIdx] || null : null,
      // With a notes column, call attempts are counted from the notes (set
      // after parsing, below) — the attempts column is the fallback.
      ...(notesIdx === -1 ? { callAttempts: Number.isFinite(attempts) ? attempts : null } : {}),
      ...(dateOptIn ? { createdAt: dateOptIn } : {}),
      // Prefer the result column's value when present (it's the more
      // decisive signal — "SOLD" tells you more than "LIVE TRANSFER") —
      // otherwise fall back to the outreach column, whichever is filled in.
      sheetStatus: rawResultStatus.trim() || rawStatus.trim() || null,
      hiveStatusRaw: rawStatus.trim() || null,
      prospectStatusRaw: rawResultStatus.trim() || null,
      awaitingClientUpdate: awaitingClient,
      sheetStatusUpdatedAt: sheetTime,
      value,
      raw,
      deletedAt: null,
    };

    if (existing) {
      claimed.set(existing.id, rowIdx);
      if (hqWins) {
        // HQ's stage stands; a sheet change it beat is logged as overridden.
        // A value typed in with the HQ change survives until the sheet has
        // one of its own.
        const { value: _sheetValue, ...keepValue } = baseData;
        pending.set(existing.id, {
          lead: existing,
          data: value == null ? keepValue : baseData,
          value,
          events: [],
          noteJob,
          ...(sheetChanged && final.stage !== existing.stage ? { overridden: final.stage } : {}),
        });
        return;
      }
      const plan = planStageEvents({
        oldStage: existing.stage,
        newStage: final.stage,
        prior,
        eventStages: eventStagesByLead.get(existing.id) ?? new Set(),
      });
      // Same stage, but the sheet's dropdown only says e.g. "LOST": keep the
      // reason HQ recorded rather than dropping it to Unknown.
      const reasons = reasonFields(final, plan.dqPhase);
      if (final.stage === existing.stage) {
        if (reasons.dqReason === "UNKNOWN" && existing.dqReason) reasons.dqReason = existing.dqReason;
        if (reasons.lostReason === "UNKNOWN" && existing.lostReason) reasons.lostReason = existing.lostReason;
        if (final.stage === "DISQUALIFIED" && existing.dqPhase) reasons.dqPhase = existing.dqPhase;
      }
      pending.set(existing.id, {
        lead: existing,
        data: { ...baseData, stage: final.stage, ...reasons },
        ...(final.stage !== existing.stage ? { stageFrom: existing.stage, stageTo: final.stage, overrodeHq: !!existing.hqStatusUpdatedAt } : {}),
        value,
        events: plan.events,
        noteJob,
      });
    } else {
      const plan = planStageEvents({ oldStage: null, newStage: final.stage, prior, eventStages: new Set() });
      creates.set(externalKey, {
        data: { id: randomUUID(), clientId, stage: final.stage, ...reasonFields(final, plan.dqPhase), ...baseData },
        events: plan.events,
        noteJob,
      });
    }
  });

  // Notes the regex rules couldn't place go to Claude in one batch. No key →
  // they stay NOTE. An API failure also leaves them NOTE but withholds the
  // new notesHash, so the next sync tries those cells again.
  const noteHolders: { data: Record<string, unknown>; noteJob?: NoteJob }[] = [...pending.values(), ...creates.values()];
  const unplaced = noteHolders.flatMap((h) => (h.noteJob?.notes ?? []).filter((n) => n.event === "NOTE").map((n) => ({ job: h.noteJob!, n })));
  let aiFailed = false;
  if (unplaced.length) {
    try {
      const events = await classifyNotesWithAI(unplaced.map((u) => u.n.rawText));
      if (events) unplaced.forEach((u, i) => ((u.n.event = events[i]), (u.n.source = "AI")));
    } catch (err) {
      aiFailed = true;
      console.error("Note classification failed — entries kept as NOTE, will retry next sync:", err);
    }
  }
  for (const h of noteHolders) {
    if (!h.noteJob) continue;
    h.data.callAttempts = h.noteJob.notes.filter((n) => n.event === "CALL_ATTEMPT").length;
    const retryLater = aiFailed && h.noteJob.notes.some((n) => n.event === "NOTE");
    if (!retryLater) h.data.notesHash = h.noteJob.hash;
  }

  // The sheet is the source of truth: an active lead whose row is gone is
  // soft-deleted. Leads without an externalKey (added outside the sheet) are
  // never touched.
  const activeLeads = existingLeads.filter((l) => !l.deletedAt);
  const staleIds = activeLeads.filter((l) => !claimed.has(l.id)).map((l) => l.id);

  // Safety guard — a renamed tab, a filter view or a bad paste can make the
  // sheet look empty. Refuse (changing nothing) rather than wipe most of a
  // client's leads.
  if (activeLeads.length > 0 && (identifiedRows === 0 || (staleIds.length > 5 && staleIds.length > activeLeads.length * 0.2))) {
    const removing = identifiedRows === 0 ? activeLeads.length : staleIds.length;
    throw new Error(`Sync aborted: would remove ${removing} of ${activeLeads.length} leads — check the sheet/tab`);
  }

  const updates = Array.from(pending.values()).filter((u) => u.events.length > 0 || u.noteJob || leadChanged(u.lead, u.data));
  const restored = updates.filter((u) => u.lead.deletedAt).length;
  const now = new Date();

  const newLeads = Array.from(creates.values());
  const events: StageEventRow[] = [
    ...newLeads.flatMap((c) => eventRows(c.data.id as string, c.events, true, now)),
    ...updates.flatMap((u) => eventRows(u.lead.id, u.events, false, now)),
  ];

  // Leads whose notes were re-parsed: their note events are replaced wholesale.
  const reparsed = [
    ...newLeads.filter((c) => c.noteJob).map((c) => ({ leadId: c.data.id as string, job: c.noteJob! })),
    ...updates.filter((u) => u.noteJob).map((u) => ({ leadId: u.lead.id, job: u.noteJob! })),
  ];
  const noteRows = reparsed.flatMap(({ leadId, job }) =>
    job.notes.map((n) => ({ leadId, at: n.at, who: n.who, event: n.event, rawText: n.rawText, source: n.source ?? ("REGEX" as const) }))
  );

  // All-or-nothing: a sync that fails halfway leaves the previous state intact.
  await prisma.$transaction(
    async (tx) => {
      for (const batch of chunks(newLeads)) {
        await tx.lead.createMany({ data: batch.map((c) => ({ ...c.data, lastSyncedAt: now })) as Prisma.LeadCreateManyInput[] });
      }
      for (const batch of chunks(updates)) {
        await Promise.all(batch.map((u) => tx.lead.update({ where: { id: u.lead.id }, data: { ...u.data, lastSyncedAt: now } })));
        // A re-sync moving an existing lead to a new stage IS a real change
        // worth an audit entry — a new lead's first stage is just ingestion.
        // A sheet change that lost to a newer HQ change is logged too.
        const activity = [
          ...batch
            .filter((u) => u.stageTo)
            .map((u) => ({ leadId: u.lead.id, fromStatus: u.stageFrom!, toStatus: u.stageTo!, value: u.value, changedBy: u.overrodeHq ? SHEET_OVERRODE_HQ : "Sheet sync" })),
          ...batch
            .filter((u) => u.overridden)
            .map((u) => ({ leadId: u.lead.id, fromStatus: u.lead.stage, toStatus: u.overridden!, value: null, changedBy: OVERRIDDEN_BY_HQ })),
        ];
        if (activity.length) await tx.leadActivity.createMany({ data: activity });
      }
      for (const batch of chunks(events)) {
        await tx.leadStageEvent.createMany({ data: batch });
      }
      for (const batch of chunks(reparsed.map((r) => r.leadId))) {
        await tx.leadNoteEvent.deleteMany({ where: { leadId: { in: batch } } });
      }
      for (const batch of chunks(noteRows)) {
        await tx.leadNoteEvent.createMany({ data: batch });
      }
      for (const batch of chunks(staleIds)) {
        await tx.lead.updateMany({ where: { id: { in: batch } }, data: { deletedAt: now } });
      }
    },
    { timeout: 120_000, maxWait: 10_000 }
  );

  const idOf = (key: string) => (creates.get(key)?.data.id as string | undefined) ?? key;
  return {
    recon: {
      sheet: {
        rows: identifiedRows,
        hive: countValues(sheetRows.map((r) => r.hive)),
        prospect: countValues(sheetRows.map((r) => r.prospect)),
        won: sheetRows.filter((r) => r.won).length,
        wonValue: sheetRows.reduce((sum, r) => sum + (r.won ? r.value ?? 0 : 0), 0),
        unmatched: identifiedRows - claimed.size - creates.size,
      },
      seenIds: [...Array.from(claimed.keys()), ...Array.from(creates.values()).map((c) => c.data.id as string)],
      badOptInLeadIds: badOptIn.map(idOf),
    },
    summary: { total: rows.length, leads: identifiedRows, created: creates.size, updated: updates.length - restored, removed: staleIds.length, restored },
    unmapped,
    automation: automation
      .filter((a) => a.writes.length)
      .map((a) => ({ leadId: creates.get(a.key)?.data.id as string | undefined ?? a.key, writes: a.writes })),
  };
}

// LeadActivity.changedBy markers for the two-way sync's conflicts.
export const SHEET_OVERRODE_HQ = "Sheet sync (overrode an HQ change)";
export const OVERRIDDEN_BY_HQ = "Sheet change overridden by HQ";

export type ClientFunnel ={ overall: FunnelGroup; campaigns: FunnelGroup[] };

function campaignKey(campaign: string | null) {
  return campaign?.trim() || "Unattributed";
}

const ALL = "__all__";

// Median + sample size for every duration column, in DURATION_KEYS order.
const medianColumns = Prisma.raw(
  DURATION_KEYS.map((k) => `percentile_cont(0.5) WITHIN GROUP (ORDER BY "${k}") FILTER (WHERE "${k}" >= 0) AS "${k}_med", COUNT(*) FILTER (WHERE "${k}" >= 0) AS "${k}_n"`).join(", ")
);

// Days from b to a. Note dates are whole days (Sydney midnight) while opt-in
// has a time, so a same-day gap can come out slightly negative — anything
// within a day clamps to 0; a real negative (bad data) stays NULL.
const gapDays = (a: string, b: string) =>
  Prisma.raw(`CASE WHEN ${a} - ${b} > INTERVAL '-1 day' THEN GREATEST(EXTRACT(EPOCH FROM (${a} - ${b})) / 86400, 0) END`);

// Median days between stages, per campaign plus client-wide (GROUPING SETS).
// Each step is dated by its milestone (lib/milestones.ts): the team's dated
// note, else the stage change the app saw live — IMPORT/INFERRED timestamps
// are guesses and never used. "Lead" is the opt-in date. n = sample size
// behind each median.
async function getFunnelDurations(clientId: string, dateRange?: { from?: Date; to?: Date }): Promise<Map<string, Durations>> {
  const fromClause = dateRange?.from ? Prisma.sql`AND "createdAt" >= ${dateRange.from}` : Prisma.empty;
  const toClause = dateRange?.to ? Prisma.sql`AND "createdAt" < ${dateRange.to}` : Prisma.empty;

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH l AS (
      SELECT id, "createdAt", COALESCE(NULLIF(TRIM(campaign), ''), 'Unattributed') AS campaign
      FROM "Lead"
      WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL ${fromClause} ${toClause}
    ), t AS (
      SELECT l.id, l.campaign, l."createdAt",
        ${milestoneSql("CONTACTED")} AS contacted,
        ${milestoneSql(HANDOVER_STAGES)} AS handover,
        ${milestoneSql("HANDOVER_LIVE")} AS live,
        ${milestoneSql("CONSULT_BOOKED")} AS booked,
        ${milestoneSql("CONSULT_ATTENDED")} AS attended,
        ${milestoneSql("QUOTE_SENT")} AS quote,
        ${milestoneSql("WON")} AS won
      FROM l
    ), d AS (
      SELECT campaign,
        ${gapDays("contacted", '"createdAt"')} AS "leadToContacted",
        ${gapDays("handover", "contacted")} AS "contactedToHandover",
        ${gapDays("live", '"createdAt"')} AS "leadToLiveTransfer",
        ${gapDays("booked", '"createdAt"')} AS "leadToBooking",
        ${gapDays("booked", "handover")} AS "handoverToBooked",
        ${gapDays("quote", "attended")} AS "consultToQuote",
        ${gapDays("won", "quote")} AS "quoteToWon",
        ${gapDays("won", '"createdAt"')} AS "leadToWon"
      FROM t
    )
    SELECT CASE WHEN GROUPING(campaign) = 1 THEN '__all__' ELSE campaign END AS campaign, ${medianColumns}
    FROM d
    GROUP BY GROUPING SETS ((campaign), ())
  `;

  return new Map(
    rows.map((r) => [
      String(r.campaign),
      Object.fromEntries(
        DURATION_KEYS.map((k) => [k, { medianDays: r[`${k}_med`] == null ? null : Number(r[`${k}_med`]), n: Number(r[`${k}_n`] ?? 0) }])
      ) as Durations,
    ])
  );
}

const emptyDurations = (): Durations => Object.fromEntries(DURATION_KEYS.map((k) => [k, { medianDays: null, n: 0 }])) as Durations;

function toGroup(campaign: string, counts: FunnelCounts, durations: Durations | undefined, spend: number | null, spendSource: FunnelGroup["spendSource"]): FunnelGroup {
  return {
    campaign,
    counts,
    rates: funnelRates(counts),
    durations: durations ?? emptyDurations(),
    spend,
    spendSource,
    costPerLead: costPer(spend, counts.leads),
    costPerContacted: costPer(spend, counts.contacted),
    costPerQualified: costPer(spend, counts.qualified),
    costPerConsult: costPer(spend, counts.consultsBooked),
    costPerWon: costPer(spend, counts.won),
  };
}

// Cohort funnel for a client: leads whose opt-in date (createdAt) is in the
// range, counted by how far each provably got (see lib/funnel.ts), per
// campaign and overall, joined with spend — Meta's live per-campaign spend
// if connected, else the manually tracked AdCampaign rows (matched by name).
// Scoped to the reporting start date and included campaigns
// (lib/reporting-scope.ts). Only the few columns the maths needs are
// selected — never `raw`.
export async function getClientFunnel(clientId: string, range?: { from?: Date; to?: Date }): Promise<ClientFunnel> {
  const scope = await getReportingScope(clientId);
  const dateRange = clampRange(range ?? {}, scope.startDate);
  const createdAt =
    dateRange.from || dateRange.to
      ? { ...(dateRange.from ? { gte: dateRange.from } : {}), ...(dateRange.to ? { lt: dateRange.to } : {}) }
      : undefined;

  const [leads, spend, durations] = await Promise.all([
    prisma.lead.findMany({
      where: { clientId, deletedAt: null, ...(createdAt ? { createdAt } : {}) },
      select: { campaign: true, stage: true, dqPhase: true, dqReason: true, lostReason: true, stageEvents: { select: { stage: true } } },
    }),
    scopedSpend(scope, dateRange),
    getFunnelDurations(clientId, dateRange),
  ]);

  const overall = emptyCounts();
  const byCampaign = new Map<string, FunnelCounts>();
  for (const l of leads) {
    const lead: FunnelLead = { ...l, campaign: campaignKey(l.campaign), eventStages: l.stageEvents.map((e) => e.stage) };
    if (!byCampaign.has(lead.campaign)) byCampaign.set(lead.campaign, emptyCounts());
    addLead(byCampaign.get(lead.campaign)!, lead);
    addLead(overall, lead);
  }

  const campaigns = Array.from(byCampaign.entries()).map(([campaign, counts]) => {
    const s = spend.byName?.get(campaign.toLowerCase().trim());
    return toGroup(campaign, counts, durations.get(campaign), s ?? null, s !== undefined ? spend.source : null);
  });

  // Client-wide spend is ALL included spend in the range (campaigns with no
  // leads still cost money), not just the campaigns that matched a lead.
  return {
    overall: toGroup(ALL, overall, durations.get(ALL), spend.total, spend.source),
    campaigns: campaigns.sort((a, b) => b.counts.leads - a.counts.leads),
  };
}
