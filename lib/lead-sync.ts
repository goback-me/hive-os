import { createHash, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getValidAccessToken, getSheetValues } from "@/lib/google-sheets";
import { clampRange, getReportingScope, scopedSpend } from "@/lib/reporting-scope";
import { classifyHive, classifyProspect, isPendingUpdate, type ClassifiedStatus } from "@/lib/status-classifier";
import { NOTES_KEYWORDS, parseNotes, type ParsedNote } from "@/lib/notes-parser";
import { classifyNotesWithAI } from "@/lib/notes-ai";
import {
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
  normalizePhone,
  normalizeStatus,
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

function normalizeIdentity(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeName(v: string | null | undefined) {
  return normalizeIdentity(v ?? "");
}

// Stored mappings may have been saved with raw sheet text as keys — always
// compare on the normalized form so "DQ " and "dq" hit the same entry.
export function normalizeMappingKeys<T>(mapping: unknown): Record<string, T> {
  if (!mapping || typeof mapping !== "object") return {};
  return Object.fromEntries(Object.entries(mapping as Record<string, T>).map(([k, v]) => [normalizeStatus(k), v]));
}

// Stored mapping JSON → {normalized value: target}; invalid entries dropped.
export function parseMapping(mapping: unknown): Record<string, StageTarget> {
  const out: Record<string, StageTarget> = {};
  for (const [k, v] of Object.entries(normalizeMappingKeys<unknown>(mapping))) {
    const t = parseTarget(v);
    if (t) out[k] = t;
  }
  return out;
}

// One status cell → stage target. The client's saved mapping wins; otherwise
// the column's keyword rules (classifyHive / classifyProspect). A value
// neither recognises is counted in `unmapped` (normalized value → rows) and
// contributes no stage.
export function resolveStatus(
  raw: string,
  mapping: Record<string, StageTarget>,
  unmapped: Record<string, number>,
  classify: (raw: string) => ClassifiedStatus | null | undefined
): StageTarget | undefined {
  const key = normalizeStatus(raw);
  if (key in mapping) return mapping[key];
  const classified = classify(raw);
  if (classified === null) return { stage: null }; // known "no outcome"
  if (classified === undefined) {
    if (key) unmapped[key] = (unmapped[key] ?? 0) + 1;
    return undefined;
  }
  return classified;
}

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

// Pulls the client's assigned sheet (read-only, always) and upserts each row
// into the Lead table. A lead whose status has been manually set in the app
// (statusManuallySetAt) never has its status overwritten by a later sync —
// every other field still refreshes normally. The outcome (time or error) is
// recorded on ClientSheet so the Leads tab can show it.
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
    const { summary, unmapped } = await runSync(clientId, sheet);
    await prisma.clientSheet.update({
      where: { clientId },
      data: { lastSyncedAt: new Date(), lastSyncError: null, unmappedStatuses: unmapped },
    });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.clientSheet.update({ where: { clientId }, data: { lastSyncError: message.slice(0, 500) } }).catch(() => {});
    throw err;
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
  sheet: NonNullable<Awaited<ReturnType<typeof prisma.clientSheet.findUnique>>>
): Promise<{ summary: SyncSummary; unmapped: UnmappedStatuses }> {
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
    const externalKey = normalizeIdentity(`${email}|${phone}|${name}`);

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

    // Does the client owe us an update (lib/lead-status.ts)? A manually set
    // stage is what the lead is actually at.
    const awaitingClient = awaitingClientUpdate({
      stage: existing?.statusManuallySetAt ? existing.stage : final.stage,
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
      value,
      raw,
      deletedAt: null,
    };

    if (existing) {
      claimed.set(existing.id, rowIdx);
      // Respect a manual override — the sheet's stage (and its events) only
      // apply while nobody has manually set this lead's stage.
      if (existing.statusManuallySetAt) {
        // A value typed in with the manual stage change survives until the
        // sheet has one of its own.
        const { value: _sheetValue, ...keepValue } = baseData;
        pending.set(existing.id, { lead: existing, data: value == null ? keepValue : baseData, value, events: [], noteJob });
        return;
      }
      const plan = planStageEvents({
        oldStage: existing.stage,
        newStage: final.stage,
        prior,
        eventStages: eventStagesByLead.get(existing.id) ?? new Set(),
      });
      pending.set(existing.id, {
        lead: existing,
        data: { ...baseData, stage: final.stage, ...reasonFields(final, plan.dqPhase) },
        ...(final.stage !== existing.stage ? { stageFrom: existing.stage, stageTo: final.stage } : {}),
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
        const activity = batch
          .filter((u) => u.stageTo)
          .map((u) => ({ leadId: u.lead.id, fromStatus: u.stageFrom!, toStatus: u.stageTo!, value: u.value, changedBy: "Sheet sync" }));
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

  return {
    summary: { total: rows.length, leads: identifiedRows, created: creates.size, updated: updates.length - restored, removed: staleIds.length, restored },
    unmapped,
  };
}

export type ClientFunnel ={ overall: FunnelGroup; campaigns: FunnelGroup[] };

function campaignKey(campaign: string | null) {
  return campaign?.trim() || "Unattributed";
}

const ALL = "__all__";

// Days from b to a. Note dates are whole days (Sydney midnight) while opt-in
// has a time, so a same-day gap can come out slightly negative — anything
// within a day clamps to 0; a real negative (bad data) stays NULL.
const gapDays = (a: string, b: string) =>
  Prisma.raw(`CASE WHEN ${a} - ${b} > INTERVAL '-1 day' THEN GREATEST(EXTRACT(EPOCH FROM (${a} - ${b})) / 86400, 0) END`);

// Median days between stages, per campaign plus client-wide (GROUPING SETS).
// Each step's time is the team's dated note (LeadNoteEvent: first call
// attempt, handover, consult booked/attended, quote) when there is one, else
// our SYNC/MANUAL stage event — IMPORT/INFERRED timestamps are guesses and
// never used. "Lead" is the opt-in date. n = sample size behind each median.
async function getFunnelDurations(clientId: string, dateRange?: { from?: Date; to?: Date }): Promise<Map<string, Durations>> {
  const fromClause = dateRange?.from ? Prisma.sql`AND "createdAt" >= ${dateRange.from}` : Prisma.empty;
  const toClause = dateRange?.to ? Prisma.sql`AND "createdAt" < ${dateRange.to}` : Prisma.empty;

  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    WITH l AS (
      SELECT id, "createdAt", COALESCE(NULLIF(TRIM(campaign), ''), 'Unattributed') AS campaign
      FROM "Lead"
      WHERE "clientId" = ${clientId} AND "deletedAt" IS NULL ${fromClause} ${toClause}
    ), f AS (
      SELECT e."leadId",
        MIN(e.at) FILTER (WHERE e.stage = 'CONTACTED') AS contacted,
        MIN(e.at) FILTER (WHERE e.stage IN ('HANDOVER_ATTEMPTED', 'HANDOVER_LIVE', 'HANDOVER_TEXT')) AS handover,
        MIN(e.at) FILTER (WHERE e.stage = 'CONSULT_BOOKED') AS booked,
        MIN(e.at) FILTER (WHERE e.stage = 'CONSULT_ATTENDED') AS attended,
        MIN(e.at) FILTER (WHERE e.stage = 'QUOTE_SENT') AS quote,
        MIN(e.at) FILTER (WHERE e.stage = 'WON') AS won
      FROM "LeadStageEvent" e
      JOIN l ON l.id = e."leadId"
      WHERE e.source IN ('SYNC', 'MANUAL')
      GROUP BY e."leadId"
    ), n AS (
      -- The team's own dated notes win over when our sync noticed a change.
      SELECT ne."leadId",
        MIN(ne.at) FILTER (WHERE ne.event = 'CALL_ATTEMPT') AS contacted,
        MIN(ne.at) FILTER (WHERE ne.event IN ('HANDOVER_LIVE', 'HANDOVER_TEXT')) AS handover,
        MIN(ne.at) FILTER (WHERE ne.event = 'CONSULT_BOOKED') AS booked,
        MIN(ne.at) FILTER (WHERE ne.event = 'CONSULT_ATTENDED') AS attended,
        MIN(ne.at) FILTER (WHERE ne.event = 'QUOTE_SENT') AS quote
      FROM "LeadNoteEvent" ne
      JOIN l ON l.id = ne."leadId"
      GROUP BY ne."leadId"
    ), t AS (
      SELECT l.id, l.campaign, l."createdAt",
        COALESCE(n.contacted, f.contacted) AS contacted,
        COALESCE(n.handover, f.handover) AS handover,
        COALESCE(n.booked, f.booked) AS booked,
        COALESCE(n.attended, f.attended) AS attended,
        COALESCE(n.quote, f.quote) AS quote,
        f.won
      FROM l
      LEFT JOIN f ON f."leadId" = l.id
      LEFT JOIN n ON n."leadId" = l.id
    ), d AS (
      SELECT campaign,
        ${gapDays("contacted", '"createdAt"')} AS "leadToContacted",
        ${gapDays("handover", "contacted")} AS "contactedToHandover",
        ${gapDays("booked", "handover")} AS "handoverToBooked",
        ${gapDays("quote", "attended")} AS "consultToQuote",
        ${gapDays("won", "quote")} AS "quoteToWon",
        ${gapDays("won", '"createdAt"')} AS "leadToWon"
      FROM t
    )
    SELECT CASE WHEN GROUPING(campaign) = 1 THEN '__all__' ELSE campaign END AS campaign,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "leadToContacted") FILTER (WHERE "leadToContacted" >= 0) AS "leadToContacted_med",
      COUNT(*) FILTER (WHERE "leadToContacted" >= 0) AS "leadToContacted_n",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "contactedToHandover") FILTER (WHERE "contactedToHandover" >= 0) AS "contactedToHandover_med",
      COUNT(*) FILTER (WHERE "contactedToHandover" >= 0) AS "contactedToHandover_n",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "handoverToBooked") FILTER (WHERE "handoverToBooked" >= 0) AS "handoverToBooked_med",
      COUNT(*) FILTER (WHERE "handoverToBooked" >= 0) AS "handoverToBooked_n",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "consultToQuote") FILTER (WHERE "consultToQuote" >= 0) AS "consultToQuote_med",
      COUNT(*) FILTER (WHERE "consultToQuote" >= 0) AS "consultToQuote_n",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "quoteToWon") FILTER (WHERE "quoteToWon" >= 0) AS "quoteToWon_med",
      COUNT(*) FILTER (WHERE "quoteToWon" >= 0) AS "quoteToWon_n",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY "leadToWon") FILTER (WHERE "leadToWon" >= 0) AS "leadToWon_med",
      COUNT(*) FILTER (WHERE "leadToWon" >= 0) AS "leadToWon_n"
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
