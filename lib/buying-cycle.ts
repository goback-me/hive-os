import { Prisma, type ClientType } from "@prisma/client";
import { prisma } from "./prisma";
import { HANDOVER_STAGES } from "./lead-status";
import { milestoneSql } from "./milestones";
import { sydneyDay, sydneyLocalToDate } from "./sheet-parse";

// A client's buying cycle: how long their leads usually take from handover
// to consult, consult to quote, and quote to a close (won or lost). Learned
// from the client's own milestone dates (lib/milestones.ts — IMPORT/INFERRED
// never count), leads since the reporting start date only. Under
// MIN_CYCLE_SAMPLE leads for a step → a default by client type. A coach's
// override (Client.cycleOverrides) beats both. Drives the reminder schedule
// (lib/reminders.ts). Cached in ClientCycle, recomputed monthly.

export const CYCLE_STEPS = ["handoverToAttended", "attendedToQuote", "quoteToClose"] as const;
export type CycleStep = (typeof CYCLE_STEPS)[number];
export const CYCLE_STEP_LABELS: Record<CycleStep, string> = {
  handoverToAttended: "Handover → attended",
  attendedToQuote: "Attended → quote",
  quoteToClose: "Quote → close",
};
// What n counts, for "(from 12 closed deals)".
export const CYCLE_SAMPLE_NOUN: Record<CycleStep, [string, string]> = {
  handoverToAttended: ["consult", "consults"],
  attendedToQuote: ["quote", "quotes"],
  quoteToClose: ["closed deal", "closed deals"],
};
export const MIN_CYCLE_SAMPLE = 5;

// ponytail: handover → attended has no default in the brief — 7 days for
// every type; change it here if consults usually take longer to land.
export const CYCLE_DEFAULTS: Record<ClientType, Record<CycleStep, number>> = {
  TRADE: { handoverToAttended: 7, attendedToQuote: 7, quoteToClose: 30 },
  SERVICE: { handoverToAttended: 7, attendedToQuote: 7, quoteToClose: 14 },
  OTHER: { handoverToAttended: 7, attendedToQuote: 7, quoteToClose: 14 },
};

export type Learned = { medianDays: number | null; n: number };
export type StepCycle = { medianDays: number; n: number; source: "learned" | "default" | "override"; learnedDays: number | null };
export type ClientCycleResult = Record<CycleStep, StepCycle> & { computedAt: Date | null };

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Only positive, finite day counts for known steps.
export function parseCycleOverrides(raw: unknown): Partial<Record<CycleStep, number>> {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Partial<Record<CycleStep, number>> = {};
  for (const k of CYCLE_STEPS) {
    const v = Number(o[k]);
    if (o[k] != null && o[k] !== "" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

// override > learned (n ≥ MIN_CYCLE_SAMPLE) > default.
export function resolveStep(step: CycleStep, learned: Learned, clientType: ClientType, overrides: Partial<Record<CycleStep, number>>): StepCycle {
  const base = { n: learned.n, learnedDays: learned.medianDays };
  if (overrides[step] != null) return { ...base, medianDays: overrides[step]!, source: "override" };
  if (learned.medianDays != null && learned.n >= MIN_CYCLE_SAMPLE) return { ...base, medianDays: learned.medianDays, source: "learned" };
  return { ...base, medianDays: CYCLE_DEFAULTS[clientType][step], source: "default" };
}

// Days per step for every lead that has both ends. A negative gap means the
// dates are wrong (a note typed with the wrong date) — left out.
export function learnFromGaps(rows: Record<CycleStep, number | null>[]): Record<CycleStep, Learned> {
  return Object.fromEntries(
    CYCLE_STEPS.map((step) => {
      const gaps = rows.map((r) => r[step]).filter((g): g is number => g != null && Number.isFinite(g) && g >= 0);
      return [step, { medianDays: median(gaps), n: gaps.length }];
    })
  ) as Record<CycleStep, Learned>;
}

const days = (a: string, b: string) => Prisma.raw(`(EXTRACT(EPOCH FROM (${a} - ${b})) / 86400)::float8`);

async function learnCycle(clientId: string) {
  const rows = await prisma.$queryRaw<Record<CycleStep, number | null>[]>`
    WITH t AS (
      SELECT
        ${milestoneSql(HANDOVER_STAGES)} AS handover,
        ${milestoneSql("CONSULT_ATTENDED")} AS attended,
        ${milestoneSql("QUOTE_SENT")} AS quote,
        ${milestoneSql(["WON", "LOST"])} AS closed
      FROM "Lead" l JOIN "Client" c ON c.id = l."clientId"
      WHERE l."clientId" = ${clientId} AND l."deletedAt" IS NULL
        AND (c."startDate" IS NULL OR l."createdAt" >= c."startDate")
    )
    SELECT ${days("attended", "handover")} AS "handoverToAttended",
           ${days("quote", "attended")} AS "attendedToQuote",
           ${days("closed", "quote")} AS "quoteToClose"
    FROM t
    WHERE (attended IS NOT NULL AND handover IS NOT NULL) OR (quote IS NOT NULL AND attended IS NOT NULL) OR (closed IS NOT NULL AND quote IS NOT NULL)
  `;
  return learnFromGaps(rows);
}

export async function recalculateCycle(clientId: string, now = new Date()) {
  const learned = await learnCycle(clientId);
  await prisma.$transaction(
    CYCLE_STEPS.map((step) =>
      prisma.clientCycle.upsert({
        where: { clientId_step: { clientId, step } },
        update: { medianDays: learned[step].medianDays, n: learned[step].n, computedAt: now },
        create: { clientId, step, medianDays: learned[step].medianDays, n: learned[step].n, computedAt: now },
      })
    )
  );
  return learned;
}

// The cycle as the reminders use it — from the cache (computed on first use).
export async function getClientCycle(clientId: string): Promise<ClientCycleResult> {
  const [client, rows] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { clientType: true, cycleOverrides: true } }),
    prisma.clientCycle.findMany({ where: { clientId } }),
  ]);
  let learned: Record<CycleStep, Learned>;
  let computedAt: Date | null;
  if (rows.length === CYCLE_STEPS.length) {
    learned = Object.fromEntries(rows.map((r) => [r.step, { medianDays: r.medianDays, n: r.n }])) as Record<CycleStep, Learned>;
    computedAt = rows[0].computedAt;
  } else {
    learned = await recalculateCycle(clientId);
    computedAt = new Date();
  }
  const overrides = parseCycleOverrides(client?.cycleOverrides);
  const type = client?.clientType ?? "OTHER";
  return {
    ...(Object.fromEntries(CYCLE_STEPS.map((s) => [s, resolveStep(s, learned[s], type, overrides)])) as Record<CycleStep, StepCycle>),
    computedAt,
  };
}

// Cron: on the 1st of each Sydney month (or for a client never computed),
// relearn every active client's cycle.
export async function recalcDueCycles(now = new Date()) {
  const [y, m] = sydneyDay(now).split("-").map(Number);
  const monthStart = sydneyLocalToDate(y, m, 1)!;
  const clients = await prisma.client.findMany({
    where: { archivedAt: null, NOT: { cycles: { some: { computedAt: { gte: monthStart } } } } },
    select: { id: true },
  });
  for (const c of clients) await recalculateCycle(c.id, now).catch((e) => console.error(`Cycle recalc for ${c.id} failed:`, e));
  return clients.length;
}
