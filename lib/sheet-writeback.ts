import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { batchUpdateValues, columnLetter, getAdminGoogleConnection, getSheetValues, getValidAccessToken, hasWriteScope } from "./google-sheets";
import { HANDOVER_STAGES, encodeTarget, targetLabel, type DqPhaseValue, type LeadStageValue, type StageTarget } from "./lead-status";
import { classifyHive, classifyProspect, normalizeStatusText, parseMapping, resolveStatus } from "./status-classifier";
import { findColumn, findHeaderIndex, normalizeEmail, normalizeName, normalizePhone } from "./sheet-parse";

// Two-way status sync, HQ → sheet. A stage changed in HQ (and the status
// automation below) becomes WriteBackJob rows — one cell each — written by
// processWriteBacks: the row is found by email → phone → name at write time
// (never a stored row number, rows move), and only the two status columns
// and Quote Value / Revenue are ever written. Nothing else in a client's
// sheet is touched.

type Column = "status" | "result";
type SheetConfig = {
  statusColumn: string | null;
  resultStatusColumn: string | null;
  statusMapping: unknown;
  resultStatusMapping: unknown;
  statusOptions: string[];
  resultStatusOptions: string[];
  writeMapping: unknown;
};
export type CellWrite = { column: string; value: string };

// Same columns the sync reads value from (lib/lead-sync.ts).
export const QUOTE_KEYWORDS = ["quote value", "quote"];
export const REVENUE_KEYWORDS = ["revenue generated", "revenue"];

// Our team's outreach stages live in HIVE STATUS; outcomes in Prospect Status.
const HIVE_STAGES: LeadStageValue[] = ["CHASE_UP", "CONTACTED", "NURTURE", "HANDOVER_ATTEMPTED", "HANDOVER_LIVE", "HANDOVER_TEXT", "CLIENT_CONTACTED"];

// What to type when a column has no dropdown — text the classifier reads back
// as exactly this stage (checked in lib/sheet-writeback.check.ts).
const PLAIN_TEXT: Record<LeadStageValue, string> = {
  CHASE_UP: "CHASE UP",
  CONTACTED: "LEAD CONTACTED",
  NURTURE: "NOT READY YET",
  HANDOVER_ATTEMPTED: "LIVE ATTEMPTED",
  HANDOVER_LIVE: "LIVE TRANSFER",
  HANDOVER_TEXT: "TEXT HAND OVER",
  CLIENT_CONTACTED: "CLIENT CONTACTED",
  CONSULT_BOOKED: "BOOKED",
  CONSULT_CANCELLED: "CANCELLED",
  CONSULT_NO_SHOW: "DIDNT ATTEND",
  CONSULT_ATTENDED: "ATTENDED",
  QUOTE_SENT: "QUOTED",
  WON: "WON",
  LOST: "LOST",
  DISQUALIFIED: "DISQUALIFIED",
};
const REASON_TEXT: Record<string, string> = {
  GHOSTED: "GHOSTED",
  SPAM: "SPAM",
  NOT_INTERESTED: "NOT INTERESTED",
  BUDGET: "BUDGET",
  LOCATION: "LOCATION",
  NOT_SUITABLE: "NOT SUITABLE",
  PRICE_SHOPPER: "PRICE SHOPPER",
  WENT_ELSEWHERE: "WENT ELSEWHERE",
};
export function plainText(t: StageTarget & { stage: LeadStageValue }) {
  const reason = t.dqReason ?? t.lostReason;
  return reason && reason !== "UNKNOWN" ? `${PLAIN_TEXT[t.stage]} ${REASON_TEXT[reason]}` : PLAIN_TEXT[t.stage];
}

const sameTarget = (a: StageTarget | undefined, b: StageTarget) =>
  !!a && a.stage === b.stage && (a.dqReason ?? null) === (b.dqReason ?? null) && (a.lostReason ?? null) === (b.lostReason ?? null);

// What a cell value means in this column — exactly how the sync reads it
// (the client's mapping first, then the column's rules).
function readsAs(value: string, column: Column, sheet: SheetConfig) {
  return column === "status"
    ? resolveStatus(value, parseMapping(sheet.statusMapping), {}, classifyHive)
    : resolveStatus(value, parseMapping(sheet.resultStatusMapping), {}, classifyProspect);
}

// The value to write for a stage in one column: the coach's override, else
// the first dropdown option that reads back as this exact stage (+ reason),
// else the first with the same stage; free-text columns get PLAIN_TEXT.
// null = the dropdown has nothing for it.
export function writeValueFor(t: StageTarget & { stage: LeadStageValue }, column: Column, sheet: SheetConfig): string | null {
  const overrides = (sheet.writeMapping as Record<Column, Record<string, string>> | null)?.[column] ?? {};
  const options = column === "status" ? sheet.statusOptions : sheet.resultStatusOptions;
  const override = overrides[encodeTarget(t)];
  if (override && (!options.length || options.includes(override))) return override;
  if (!options.length) return plainText(t);
  return options.find((o) => sameTarget(readsAs(o, column, sheet), t)) ?? options.find((o) => readsAs(o, column, sheet)?.stage === t.stage) ?? null;
}

// Which column a stage goes to (outreach → HIVE STATUS, outcome → Prospect
// Status; a DQ goes where the lead was — before handover = hive), falling
// back to the other column when the preferred one can't take it.
export function planStageWrite(t: StageTarget & { stage: LeadStageValue }, dqPhase: DqPhaseValue | null, sheet: SheetConfig): CellWrite | { error: string } {
  const hiveFirst = HIVE_STAGES.includes(t.stage) || (t.stage === "DISQUALIFIED" && dqPhase !== "POST_HANDOVER");
  const order: Column[] = hiveFirst ? ["status", "result"] : ["result", "status"];
  for (const column of order) {
    const header = column === "status" ? sheet.statusColumn : sheet.resultStatusColumn;
    if (!header) continue;
    const value = writeValueFor(t, column, sheet);
    if (value) return { column: header, value };
  }
  if (!sheet.statusColumn && !sheet.resultStatusColumn) return { error: "No status column is set for this sheet" };
  return { error: `No "${targetLabel(t)}" option in the sheet's status dropdowns — pick one in Leads settings` };
}

// Status automation — runs on every sync (per row) and after every HQ
// change, and only fills in what's missing:
// - HIVE STATUS blank / "new lead" → "CHASE UP"
// - Prospect Status blank / N/A while HIVE STATUS is self/auto booked → "AUTO BOOKED"
// - Prospect Status blank / N/A after a handover (live, text, client
//   contacted, nurture) → "PENDING UPDATE" (the client owes us an update)
// Chase Up / DQ leave Prospect Status as it is (no client update needed).
export function automationWrites(hive: { raw: string; stage: LeadStageValue | null }, prospectRaw: string, sheet: SheetConfig): CellWrite[] {
  const out: CellWrite[] = [];
  const h = normalizeStatusText(hive.raw);
  const p = normalizeStatusText(prospectRaw);
  const option = (column: Column, text: string) => {
    const options = column === "status" ? sheet.statusOptions : sheet.resultStatusOptions;
    return options.length ? options.find((o) => normalizeStatusText(o) === normalizeStatusText(text)) ?? null : text;
  };

  if (sheet.statusColumn && (h === "" || h === "new lead")) {
    const v = option("status", "CHASE UP") ?? writeValueFor({ stage: "CHASE_UP" }, "status", sheet);
    if (v) out.push({ column: sheet.statusColumn, value: v });
  }
  if (sheet.resultStatusColumn && (p === "" || p === "n a" || p === "na")) {
    const v = /\b(self|auto) booked\b/.test(h)
      ? option("result", "AUTO BOOKED")
      : hive.stage && HANDOVER_STAGES.includes(hive.stage)
      ? option("result", "PENDING UPDATE")
      : null;
    if (v) out.push({ column: sheet.resultStatusColumn, value: v });
  }
  return out;
}

// HQ stage change → the cells to write: the status cell, plus the job value
// on Won (Revenue, else Quote Value) or the quote on Quote Sent.
export function stageChangeWrites(
  lead: { stage: LeadStageValue; dqReason: string | null; lostReason: string | null; dqPhase: DqPhaseValue | null; value: number | null },
  sheet: SheetConfig & { allColumns: string[] }
): { writes: CellWrite[]; error: string | null } {
  const t = { stage: lead.stage, dqReason: lead.dqReason ?? undefined, lostReason: lead.lostReason ?? undefined } as StageTarget & { stage: LeadStageValue };
  const plan = planStageWrite(t, lead.dqPhase, sheet);
  const writes: CellWrite[] = "error" in plan ? [] : [plan];
  if (lead.value != null && (lead.stage === "WON" || lead.stage === "QUOTE_SENT")) {
    const revenueIdx = findColumn(sheet.allColumns, REVENUE_KEYWORDS);
    const quoteIdx = findColumn(sheet.allColumns, QUOTE_KEYWORDS);
    const idx = lead.stage === "WON" && revenueIdx !== -1 ? revenueIdx : quoteIdx;
    if (idx !== -1) writes.push({ column: sheet.allColumns[idx], value: String(lead.value) });
  }
  return { writes, error: "error" in plan ? plan.error : null };
}

// Queue cells for one lead. A newer value for the same cell replaces a
// still-pending one; the same value already pending (or failed in the last
// day) isn't queued again — so a 5-minute sync can't pile up duplicates.
export async function queueWrites(clientId: string, leadId: string, writes: CellWrite[]) {
  const dayAgo = new Date(Date.now() - 86_400_000);
  for (const w of writes) {
    const existing = await prisma.writeBackJob.findFirst({
      where: { leadId, column: w.column, value: w.value, OR: [{ status: { in: ["PENDING", "RUNNING"] } }, { status: "FAILED", createdAt: { gt: dayAgo } }] },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.$transaction([
      prisma.writeBackJob.deleteMany({ where: { leadId, column: w.column, status: "PENDING" } }),
      prisma.writeBackJob.create({ data: { clientId, leadId, column: w.column, value: w.value } }),
    ]);
  }
}

const RATE_PER_MINUTE = 50;
const MAX_ATTEMPTS = 6;

// Writes due jobs, at most 50 cells a minute across the app (counted from
// DONE rows, so overlapping runs share the budget), batching each client's
// cells into one values.batchUpdate. Runs until the queue is empty or
// `maxMs` is up — the cron gives it minutes, an HQ change a few seconds.
export async function processWriteBacks({ maxMs = 15_000 }: { maxMs?: number } = {}) {
  const deadline = Date.now() + maxMs;
  const result = { written: 0, failed: 0, retried: 0 };
  // A run that died mid-write leaves RUNNING jobs — give them back.
  await prisma.writeBackJob.updateMany({ where: { status: "RUNNING", runAfter: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: "PENDING" } });

  while (Date.now() < deadline) {
    const now = new Date();
    const recent = await prisma.writeBackJob.findMany({
      where: { status: "DONE", doneAt: { gt: new Date(now.getTime() - 60_000) } },
      select: { doneAt: true },
      orderBy: { doneAt: "asc" },
    });
    const budget = RATE_PER_MINUTE - recent.length;
    if (budget <= 0) {
      const wait = recent[0].doneAt!.getTime() + 60_000 - Date.now();
      if (Date.now() + wait > deadline) break;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    const due = await prisma.writeBackJob.findMany({
      where: { status: "PENDING", runAfter: { lte: now } },
      orderBy: { createdAt: "asc" },
      take: budget,
      select: { id: true },
    });
    if (!due.length) break;
    const claimId = randomUUID();
    await prisma.writeBackJob.updateMany({ where: { id: { in: due.map((d) => d.id) }, status: "PENDING" }, data: { status: "RUNNING", claimId, runAfter: now } });
    const jobs = await prisma.writeBackJob.findMany({ where: { claimId, status: "RUNNING" }, include: { lead: { select: { name: true, email: true, phone: true } } } });

    const byClient = new Map<string, typeof jobs>();
    for (const j of jobs) byClient.set(j.clientId, [...(byClient.get(j.clientId) ?? []), j]);
    for (const [clientId, clientJobs] of byClient) {
      const r = await writeClientJobs(clientId, clientJobs);
      result.written += r.written;
      result.failed += r.failed;
      result.retried += r.retried;
    }
  }
  return result;
}

type Job = { id: string; leadId: string; column: string; value: string; attempts: number; lead: { name: string | null; email: string | null; phone: string | null } };

async function fail(jobs: Job[], error: string) {
  if (!jobs.length) return;
  await prisma.$transaction([
    prisma.writeBackJob.updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { status: "FAILED", error: error.slice(0, 500), claimId: null } }),
    prisma.lead.updateMany({ where: { id: { in: jobs.map((j) => j.leadId) } }, data: { sheetWriteError: error.slice(0, 300) } }),
  ]);
}

async function writeClientJobs(clientId: string, jobs: Job[]) {
  const out = { written: 0, failed: 0, retried: 0 };
  const failAll = async (error: string) => {
    await fail(jobs, error);
    out.failed += jobs.length;
    return out;
  };

  const [conn, sheet] = await Promise.all([getAdminGoogleConnection(), prisma.clientSheet.findUnique({ where: { clientId } })]);
  if (!hasWriteScope(conn)) return failAll("Google needs reconnecting with write access (Leads page)");
  if (!sheet) return failAll("No sheet assigned to this client");

  let headers: string[], rows: string[][], token: string;
  try {
    token = await getValidAccessToken();
    ({ headers, rows } = await getSheetValues(token, sheet.spreadsheetId, sheet.sheetName));
  } catch (e) {
    return failAll(e instanceof Error ? e.message : "Couldn't read the sheet");
  }

  // Only these columns may ever be written.
  const allowed = new Set(
    [sheet.statusColumn, sheet.resultStatusColumn, headers[findColumn(headers, QUOTE_KEYWORDS)], headers[findColumn(headers, REVENUE_KEYWORDS)]]
      .filter((h): h is string => !!h)
      .map((h) => headers[findHeaderIndex(headers, h)])
      .filter(Boolean)
  );
  const nameIdx = findColumn(headers, ["name", "full name"], ["campaign", "ad", "adset", "ad set", "business"]);
  const phoneIdx = findColumn(headers, ["phone"]);
  const emailIdx = findColumn(headers, ["email"]);
  const index = (idx: number, norm: (v: string) => string) => {
    const m = new Map<string, number>();
    if (idx !== -1) rows.forEach((r, i) => {
      const k = norm(r[idx] ?? "");
      if (k && !m.has(k)) m.set(k, i);
    });
    return m;
  };
  const byEmail = index(emailIdx, normalizeEmail);
  const byPhone = index(phoneIdx, normalizePhone);
  const byName = index(nameIdx, normalizeName);
  const tab = `'${sheet.sheetName.replace(/'/g, "''")}'`;

  const ready: Job[] = [];
  const data: { range: string; values: string[][] }[] = [];
  for (const j of jobs) {
    const colIdx = findHeaderIndex(headers, j.column);
    if (colIdx === -1 || !allowed.has(headers[colIdx])) {
      await fail([j], colIdx === -1 ? `Column "${j.column}" not found in the sheet` : `Column "${j.column}" isn't one HQ may write`);
      out.failed++;
      continue;
    }
    const e = normalizeEmail(j.lead.email);
    const p = normalizePhone(j.lead.phone);
    const n = normalizeName(j.lead.name);
    const row = [e ? byEmail.get(e) : undefined, p ? byPhone.get(p) : undefined, n ? byName.get(n) : undefined].find((r) => r !== undefined);
    if (row === undefined) {
      await fail([j], "Lead's row not found in the sheet (matched by email, phone, then name)");
      out.failed++;
      continue;
    }
    ready.push(j);
    data.push({ range: `${tab}!${columnLetter(colIdx)}${row + 2}`, values: [[j.value]] });
  }
  if (!ready.length) return out;

  const res = await batchUpdateValues(token, sheet.spreadsheetId, data);
  if (res.status === 429) {
    // Rate limited: back off 30s, 1m, 2m, 4m… then give up.
    for (const j of ready) {
      const attempts = j.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) await fail([j], "Google kept rate-limiting writes — will retry on the next change");
      else
        await prisma.writeBackJob.update({
          where: { id: j.id },
          data: { status: "PENDING", attempts, claimId: null, runAfter: new Date(Date.now() + 2 ** (attempts - 1) * 30_000) },
        });
    }
    out.retried += ready.length;
    return out;
  }
  if (!res.ok) {
    await fail(ready, `Google rejected the write (${res.status}): ${res.error ?? ""}`);
    out.failed += ready.length;
    return out;
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.writeBackJob.updateMany({ where: { id: { in: ready.map((j) => j.id) } }, data: { status: "DONE", doneAt: now, error: null, claimId: null } }),
    prisma.lead.updateMany({ where: { id: { in: ready.map((j) => j.leadId) } }, data: { sheetWriteError: null } }),
  ]);
  out.written += ready.length;
  return out;
}

// Fire-and-forget after an HQ change, so the sheet updates within seconds;
// whatever doesn't fit (rate limit) is picked up by the cron.
export function kickWriteBacks() {
  processWriteBacks({ maxMs: 10_000 }).catch((e) => console.error("Write-back run failed:", e));
}

// After an HQ stage change: queue the lead's status cell (+ value cell) and
// whatever the automation then needs, given the cells as they'll be once
// written. A stage the sheet can't express is recorded as the lead's
// "Not synced to sheet" reason instead of queued.
export async function queueLeadChange(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  const sheet = lead && (await prisma.clientSheet.findUnique({ where: { clientId: lead.clientId } }));
  if (!lead || !sheet) return;

  const { writes, error } = stageChangeWrites({ ...lead, value: lead.value == null ? null : Number(lead.value) }, sheet);
  const current = (column: string) =>
    column === sheet.statusColumn ? lead.hiveStatusRaw ?? "" : column === sheet.resultStatusColumn ? lead.prospectStatusRaw ?? "" : null;
  const after = (column: string | null) => (column ? writes.find((w) => w.column === column)?.value ?? current(column) ?? "" : "");
  const hiveRaw = after(sheet.statusColumn);
  const hiveStage = sheet.statusColumn ? resolveStatus(hiveRaw, parseMapping(sheet.statusMapping), {}, classifyHive)?.stage ?? null : null;
  const auto = automationWrites({ raw: hiveRaw, stage: hiveStage }, after(sheet.resultStatusColumn), sheet).filter((a) => !writes.some((w) => w.column === a.column));

  // Skip cells that already say exactly this.
  const todo = [...writes, ...auto].filter((w) => {
    const cur = current(w.column);
    return cur === null || normalizeStatusText(cur) !== normalizeStatusText(w.value);
  });
  if (error) await prisma.lead.update({ where: { id: leadId }, data: { sheetWriteError: error } });
  if (todo.length) await queueWrites(lead.clientId, leadId, todo);
}
