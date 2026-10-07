"use server";

import { Prisma, type CallFrequency, type ClientHealth, type ClientMood, type Weekday } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireAdmin, requireCoach, requireClientAccess, requireUser } from "@/lib/auth";
import { getClerkAdminClient } from "@/lib/clerk-admin";
import { syncLeadsFromSheet, type SyncSummary } from "@/lib/lead-sync";
import { CLIENT_STAGES, HANDOVER_STAGES, isReturn, parseTarget, planStageEvents } from "@/lib/lead-status";
import { refreshHandoverAt } from "@/lib/reminders";
import { parseCycleOverrides, recalculateCycle, type CycleStep } from "@/lib/buying-cycle";
import { parseVisibility, type ReportVisibility } from "@/lib/report-visibility";
import { kickWriteBacks, queueLeadChange } from "@/lib/sheet-writeback";
import { getMonthToDateVsLast, rebuildHistory } from "@/lib/kpi";
import { reportsOnHold } from "@/lib/report-hold";
import { sendActionEmail } from "@/lib/email";
import { runHealthChecks } from "@/lib/data-health";
import { kickSlack, parseSlackEvents, queueLeadEvent, queueSlack, queueTestMessage } from "@/lib/slack";
import { NOT_HELD_REASONS, WEEKDAYS, applySlotChange, dropFutureCalls, callDateLabel, callTaskUpdate, clientCallEmail, ensureNextCall, isCallTime, moveCall, parseCallWhen, rescheduleCall, sendCallInvite, splitSteps } from "@/lib/am-calls";
import { createClientFolder, ensureTask, finishTask } from "@/lib/clickup";
import { sydneyLocalToDate } from "@/lib/sheet-parse";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ── Referral pipeline ──────────────────────────────────────────────────
const REFERRAL_STAGES = ["INTRODUCED", "REACHED_OUT", "IN_CONVERSATION", "CALL_BOOKED", "CALL_DONE", "WON"];

export async function updateReferralStage(id: string, stage: string) {
  await requireCoach();
  if (!REFERRAL_STAGES.includes(stage)) throw new Error("Invalid referral stage");
  await prisma.referral.update({ where: { id }, data: { stage: stage as never } });
  revalidatePath("/referrals");
}

export async function createReferral(formData: FormData) {
  await requireCoach();
  const name = String(formData.get("name") || "").trim();
  const source = String(formData.get("source") || "").trim();
  const note = String(formData.get("note") || "").trim();
  if (!name) throw new Error("Name is required");

  await prisma.referral.create({
    data: { name, source: source || null, note: note || null, stage: "INTRODUCED" },
  });
  revalidatePath("/referrals");
}

function randomCode(len = 8) {
  const chars = "abcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export async function createReferralLink(formData: FormData) {
  await requireCoach();
  const label = String(formData.get("label") || "").trim();
  if (!label) throw new Error("Label is required");

  let code = randomCode();
  while (await prisma.referralLink.findUnique({ where: { code } })) {
    code = randomCode();
  }

  await prisma.referralLink.create({ data: { label, code } });
  revalidatePath("/referrals");
}

// Every client gets their own unique referral link, auto-created the first
// time it's needed (at client creation, or lazily for a client that existed
// before this feature) — @unique on ReferralLink.clientId means calling
// this twice for the same client is safe and returns the existing one.
export async function getOrCreateClientReferralLink(clientId: string, clientLabel: string) {
  await requireClientAccess(clientId);
  const existing = await prisma.referralLink.findUnique({ where: { clientId } });
  if (existing) return existing;

  let code = randomCode();
  while (await prisma.referralLink.findUnique({ where: { code } })) {
    code = randomCode();
  }
  return prisma.referralLink.create({ data: { clientId, label: `${clientLabel} referrals`, code } });
}

// ponytail: in-memory, per-process rate limit — resets on restart and isn't
// shared across replicas. Move to Redis/Postgres if we ever run >1 instance.
const REFERRAL_LIMIT = 5;
const REFERRAL_WINDOW_MS = 10 * 60 * 1000;
const referralHits = new Map<string, number[]>();

function referralRateLimited(ip: string) {
  const now = Date.now();
  const hits = (referralHits.get(ip) ?? []).filter((t) => now - t < REFERRAL_WINDOW_MS);
  if (hits.length >= REFERRAL_LIMIT) {
    referralHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  referralHits.set(ip, hits);
  if (referralHits.size > 10_000) referralHits.clear(); // crude memory cap
  return false;
}

// Public submission — used by the /refer/[code] page, no auth required
export async function submitPublicReferral(code: string, formData: FormData) {
  // Honeypot: real users never see or fill this field — bots do. Drop silently.
  if (String(formData.get("website") || "").trim()) return;

  const h = headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  if (referralRateLimited(ip)) throw new Error("Too many submissions — try again in a few minutes");

  const name = String(formData.get("name") || "").trim();
  const source = String(formData.get("source") || "").trim();
  const note = String(formData.get("note") || "").trim();
  if (!name) throw new Error("Name is required");

  const link = await prisma.referralLink.findUnique({ where: { code } });
  if (!link) throw new Error("Invalid referral link");

  await prisma.referral.create({
    data: {
      name: name.slice(0, 200),
      source: source.slice(0, 200) || null,
      note: note.slice(0, 2000) || null,
      stage: "INTRODUCED",
      referralLinkId: link.id,
    },
  });
}
// ── Tasks ──────────────────────────────────────────────────────────────
export async function createTask(formData: FormData) {
  const title = String(formData.get("title") || "").trim();
  const clientId = String(formData.get("clientId") || "") || null;
  const assignee = String(formData.get("assignee") || "").trim();
  const dueDateRaw = String(formData.get("dueDate") || "");
  if (!title) throw new Error("Task title is required");

  // A client can only create tasks under their own record; a coach can assign to anyone.
  await requireClientAccess(clientId ?? "");

  await prisma.task.create({
    data: {
      title,
      clientId,
      assignee: assignee || null,
      dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
    },
  });
  revalidatePath("/tasks");
  revalidatePath("/clients");
}

export async function updateTaskStatus(id: string, status: string) {
  const task = await prisma.task.findUnique({ where: { id }, select: { clientId: true } });
  if (!task) throw new Error("Task not found");
  await requireClientAccess(task.clientId ?? "");

  await prisma.task.update({ where: { id }, data: { status: status as never } });
  revalidatePath("/tasks");
  revalidatePath("/clients");
}

// ── Onboarding — completing a step never blocks the UI, just updates state ─
export async function toggleOnboardingStep(clientId: string, templateId: string, completed: boolean) {
  await requireClientAccess(clientId);
  await prisma.clientOnboardingStep.upsert({
    where: { clientId_templateId: { clientId, templateId } },
    update: { completedAt: completed ? new Date() : null },
    create: { clientId, templateId, completedAt: completed ? new Date() : null },
  });
  revalidatePath(`/clients`);
}

export async function createOnboardingStepTemplate(formData: FormData) {
  await requireCoach();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  if (!title) throw new Error("Title is required");

  const count = await prisma.onboardingStepTemplate.count();
  await prisma.onboardingStepTemplate.create({
    data: { title, description: description || null, order: count },
  });
  revalidatePath("/settings");
}

// ── Progress notes — a coach or the client themselves can log one ────────
export async function createProgressNote(clientId: string, formData: FormData) {
  const user = await requireClientAccess(clientId);
  const note = String(formData.get("note") || "").trim();
  if (!note) throw new Error("Note can't be empty");
  await prisma.progressNote.create({ data: { clientId, note, createdBy: user.name } });
  revalidatePath(`/clients`);
}

// ── Leads tab — sync from the assigned Google Sheet + manual status edits ─
// Returns the error instead of throwing — Next.js hides thrown server-action
// messages in production, which made failed syncs impossible to diagnose.
export async function syncClientLeads(clientId: string): Promise<{ summary: SyncSummary } | { error: string }> {
  await requireClientAccess(clientId);
  try {
    const summary = await syncLeadsFromSheet(clientId);
    revalidatePath(`/clients`);
    return { summary };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Sync failed" };
  }
}

// A stage change made in HQ (coach or the lead's own client). It's written
// back to the sheet's status cell (lib/sheet-writeback.ts) and, until the
// sheet changes again after it, HQ's stage is the one that stands — see the
// two-way sync in lib/lead-sync.ts. `target` is a stage, optionally with a
// reason: "WON", "DISQUALIFIED:BUDGET", "LOST:GHOSTED" (same encoding as the
// mapping dropdowns).
export async function updateLeadStage(leadId: string, target: string, value?: number) {
  const parsed = parseTarget(target);
  if (!parsed?.stage) throw new Error("Invalid lead stage");
  const stage = parsed.stage;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.deletedAt) throw new Error("Lead not found");
  const user = await requireClientAccess(lead.clientId);
  // A client sets only their side of the deal (lib/lead-status.ts CLIENT_STAGES).
  if (user.role === "CLIENT" && !CLIENT_STAGES.includes(stage)) throw new Error("Only the Hive team can set that stage");

  const eventStages = new Set(
    (await prisma.leadStageEvent.findMany({ where: { leadId }, select: { stage: true } })).map((e) => e.stage)
  );
  const plan = planStageEvents({ oldStage: lead.stage, newStage: stage, prior: null, eventStages });
  const now = new Date();
  // Sent back to Chase Up after a handover: a RETURNED_BY_CLIENT event, counted on the lead.
  const returned = isReturn(lead.stage, stage);
  const source = (e: { kind: string; stage: string }) => (e.kind === "inferred" ? ("INFERRED" as const) : returned && e.stage === "CHASE_UP" ? ("RETURNED_BY_CLIENT" as const) : ("MANUAL" as const));

  await prisma.$transaction([
    prisma.leadActivity.create({
      data: { leadId, fromStatus: lead.stage, toStatus: stage, value: value ?? null, changedBy: user.name },
    }),
    prisma.leadStageEvent.createMany({
      data: plan.events.map((e) => ({ leadId, stage: e.stage, at: now, source: source(e) })),
    }),
    prisma.lead.update({
      where: { id: leadId },
      data: {
        stage,
        dqReason: stage === "DISQUALIFIED" ? parsed.dqReason ?? "UNKNOWN" : null,
        // Re-picking the reason on an already-DQ'd lead keeps how far it got.
        dqPhase: stage === "DISQUALIFIED" ? (lead.stage === "DISQUALIFIED" && lead.dqPhase ? lead.dqPhase : plan.dqPhase) : null,
        lostReason: stage === "LOST" ? parsed.lostReason ?? "UNKNOWN" : null,
        dqReasonSource: stage === "DISQUALIFIED" ? "MANUAL" : null,
        dqReasonEvidence: null,
        ...(returned ? { returnedCount: { increment: 1 }, lastReturnedAt: now } : {}),
        hqStatusUpdatedAt: now,
        // A handover → the client owes us an update (PENDING UPDATE goes to
        // the sheet via queueLeadChange); any other stage is their answer.
        awaitingClientUpdate: HANDOVER_STAGES.includes(stage),
        staleInStage: false, // a new stage starts its own clock (lib/reminders.ts)
        ...(value !== undefined ? { value } : {}),
      },
    }),
  ]);
  await refreshHandoverAt({ leadId });
  await queueLeadChange(leadId);
  kickWriteBacks();
  // Slack (queued, never blocking): a sale once it has its value, a live transfer.
  const after = value !== undefined ? value : lead.value == null ? null : Number(lead.value);
  if (stage === "WON" && after != null) await queueLeadEvent(leadId, "sale").catch(() => {});
  if (stage === "HANDOVER_LIVE") await queueLeadEvent(leadId, "live_transfer").catch(() => {});
  if (stage === "WON" || stage === "HANDOVER_LIVE") kickSlack();
  revalidatePath(`/clients`);
}

// A coach or the lead's own client can leave a follow-up note — same
// access rule as ProgressNote, just scoped to one lead instead of the client.
export async function addLeadNote(leadId: string, formData: FormData) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clientId: true, deletedAt: true } });
  if (!lead || lead.deletedAt) throw new Error("Lead not found");
  const user = await requireClientAccess(lead.clientId);

  const note = String(formData.get("note") || "").trim();
  if (!note) throw new Error("Note can't be empty");

  await prisma.leadNote.create({ data: { leadId, note, createdBy: user.name } });
  revalidatePath(`/clients`);
}

// ── Google Drive link (client page header — components/DriveLinkButton.tsx) ──
export async function saveGameplanLink(clientId: string, formData: FormData) {
  const user = await requireClientAccess(clientId);
  if (user.role !== "COACH") throw new Error("Only the Hive team can change the Drive link");
  const link = String(formData.get("figmaLink") || "").trim();
  if (link && !/^https:\/\/(?:drive|docs)\.google\.com\//.test(link)) throw new Error("That doesn't look like a Google Drive / Docs link");
  await prisma.client.update({ where: { id: clientId }, data: { gameplanFigmaLink: link || null } });
  revalidatePath(`/clients`);
}

export async function saveClientGoals(clientId: string, goals: string) {
  await requireClientAccess(clientId);
  await prisma.client.update({ where: { id: clientId }, data: { goals: goals.trim() || null } });
  revalidatePath(`/clients`);
}

// Coach-only: what this client's own login may see in their reports.
export async function saveReportVisibility(clientId: string, flags: Partial<ReportVisibility>) {
  await requireCoach();
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { reportVisibility: true, slug: true } });
  if (!client) throw new Error("Client not found");
  const next = parseVisibility({ ...parseVisibility(client.reportVisibility), ...flags });
  await prisma.client.update({ where: { id: clientId }, data: { reportVisibility: next } });
  revalidatePath(`/clients/${client.slug}`);
  return next;
}

// Coach-only: the client's onboarding date ("YYYY-MM-DD", Sydney; "" clears
// it). Reports only count leads/sales/spend from this day on. Stored months
// rebuilt under the old scope (BACKFILL) are dropped and recompute live until
// "Rebuild history"; FROZEN months are never touched.
export async function saveClientStartDate(clientId: string, day: string) {
  await requireCoach();
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const startDate = m ? sydneyLocalToDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  if (day && !startDate) throw new Error("Invalid date");
  await prisma.$transaction([
    prisma.client.update({ where: { id: clientId }, data: { startDate } }),
    prisma.monthlyKpi.deleteMany({ where: { clientId, source: "BACKFILL" } }),
  ]);
  revalidatePath(`/clients`);
}

// Coach-only: include/exclude one campaign's spend from reports. `included`
// null = back to the default (started on/after the start date). A Meta
// campaign gets an AdCampaign row (by metaCampaignId) to hold the override.
export async function setCampaignReporting(
  clientId: string,
  campaign: { id: string; name: string; source: "meta" | "manual" },
  included: boolean | null
) {
  await requireCoach();
  await prisma.$transaction([
    campaign.source === "meta"
      ? prisma.adCampaign.upsert({
          where: { clientId_metaCampaignId: { clientId, metaCampaignId: campaign.id } },
          create: { clientId, metaCampaignId: campaign.id, name: campaign.name, includedInReporting: included },
          update: { name: campaign.name, includedInReporting: included },
        })
      : prisma.adCampaign.update({ where: { id: campaign.id, clientId }, data: { includedInReporting: included } }),
    prisma.monthlyKpi.deleteMany({ where: { clientId, source: "BACKFILL" } }),
  ]);
}

// Coach-only: recompute Snapshot history for every closed month that isn't
// frozen (lib/kpi.ts rebuildHistory).
export async function rebuildKpiHistory(clientId: string) {
  await requireCoach();
  const months = await rebuildHistory(clientId);
  revalidatePath(`/clients`);
  return { months: months.length };
}

// Coach-only: TRADE / SERVICE / OTHER — changes report wording (lib/client-terms.ts).
export async function saveClientType(clientId: string, clientType: string) {
  await requireCoach();
  if (!["TRADE", "SERVICE", "OTHER"].includes(clientType)) throw new Error("Invalid client type");
  await prisma.client.update({ where: { id: clientId }, data: { clientType: clientType as "TRADE" | "SERVICE" | "OTHER" } });
  revalidatePath(`/clients`);
}

// Coach-only: the buying-cycle overrides (days per step; blank = learned /
// default) and an on-demand relearn (lib/buying-cycle.ts).
export async function saveCycleOverrides(clientId: string, overrides: Partial<Record<CycleStep, number | null>>) {
  await requireCoach();
  const clean = parseCycleOverrides(overrides);
  await prisma.client.update({ where: { id: clientId }, data: { cycleOverrides: Object.keys(clean).length ? clean : Prisma.DbNull } });
  revalidatePath(`/clients`);
}

// Coach-only: feedback-cell name aliases, one "short = Full name" per line.
export async function saveNoteAliases(clientId: string, text: string) {
  await requireCoach();
  const aliases = Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.split("=").map((s) => s.trim()))
      .filter((p) => p.length === 2 && p[0] && p[1])
      .map(([k, v]) => [k.toLowerCase(), v])
  );
  await prisma.client.update({ where: { id: clientId }, data: { noteAliases: Object.keys(aliases).length ? aliases : Prisma.DbNull } });
  revalidatePath(`/clients`);
}

export async function recalculateClientCycle(clientId: string) {
  await requireCoach();
  await recalculateCycle(clientId);
  revalidatePath(`/clients`);
}

// Coach-only: re-run a client's data health checks now (lib/data-health.ts).
export async function recheckClientHealth(clientId: string) {
  await requireCoach();
  const findings = await runHealthChecks(clientId);
  revalidatePath(`/clients`);
  return { open: findings.length };
}

// ── Account management (coach only) ──────────────────────────────────────

// Log a call / meeting / message with the client. The latest one is the
// portfolio's "Last contact" and drives the "no call in 10+ days" action.
// ── Weekly call (lib/am-calls.ts) ─────────────────────────────────
// Coach-only: the client email the "update your leads" emails go to (when
// the client has no login of their own).
export async function saveClientEmail(clientId: string, email: string) {
  await requireCoach();
  const e = email.trim().toLowerCase();
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("That email doesn't look right");
  await prisma.client.update({ where: { id: clientId }, data: { email: e || null } });
  revalidatePath(`/clients`);
}

// ── Account-manager calls (lib/am-calls.ts) ──────────────────────────────

// The team member who may act on a client's calls: a coach/admin, or the
// agent who account-manages them. Clients never.
async function requireCallAccess(clientId: string) {
  const user = await requireClientAccess(clientId);
  if (user.role !== "COACH") throw new Error("Only the Hive team manages calls");
  return user;
}
const myUserId = async (clerkId: string) => (await prisma.user.findUnique({ where: { clerkId }, select: { id: true } }))?.id ?? null;
const callOf = async (callId: string) => {
  const call = await prisma.amCall.findUnique({ where: { id: callId } });
  if (!call) throw new Error("Call not found");
  return call;
};
function whenOrThrow(s: string, defaultTime = "10:00") {
  const at = parseCallWhen(s, defaultTime);
  if (!at) throw new Error("Pick a date and time");
  return at;
}

// Coach-only: the account manager and their regular call slot. The client's
// next call follows a slot change (if it hasn't happened yet).
export async function saveCallSlot(clientId: string, slot: { accountManagerId: string | null; callDay: string; callTime: string; callFrequency: string }) {
  await requireCoach();
  if (!WEEKDAYS.includes(slot.callDay as Weekday)) throw new Error("Invalid day");
  if (!isCallTime(slot.callTime)) throw new Error("Time is HH:MM, e.g. 10:00");
  if (!["WEEKLY", "FORTNIGHTLY"].includes(slot.callFrequency)) throw new Error("Invalid frequency");
  if (slot.accountManagerId) {
    const am = await prisma.user.findUnique({ where: { id: slot.accountManagerId }, select: { role: true } });
    if (!am || am.role === "CLIENT") throw new Error("Pick a team member");
  }
  await prisma.client.update({
    where: { id: clientId },
    data: { accountManagerId: slot.accountManagerId || null, callDay: slot.callDay as Weekday, callTime: slot.callTime, callFrequency: slot.callFrequency as CallFrequency },
  });
  await applySlotChange(clientId);
  revalidatePath("/", "layout");
}

// Coach-only: the manual health override (null = use the computed one).
export async function saveHealthOverride(clientId: string, health: string | null) {
  await requireCoach();
  if (health && !["ON_TRACK", "AT_RISK", "CRITICAL"].includes(health)) throw new Error("Invalid health");
  await prisma.client.update({ where: { id: clientId }, data: { healthOverride: (health as ClientHealth) || null } });
  revalidatePath("/", "layout");
}

// Book a call at `when` ("YYYY-MM-DDTHH:MM", Sydney) — [Schedule] for a
// client with no next call. Goes to the account manager (else whoever books it).
export async function scheduleCall(clientId: string, when: string) {
  const user = await requireCallAccess(clientId);
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { accountManagerId: true, callTime: true } });
  const call = await prisma.amCall.create({ data: { clientId, scheduledAt: whenOrThrow(when, client.callTime), callPersonId: client.accountManagerId ?? (await myUserId(user.clerkId)) } });
  await sendCallInvite(call.id);
  revalidatePath("/", "layout");
  return call.id;
}

// "Log a call" / "Log now": the client's call to update — the oldest one
// still waiting, else the next booked one, else a new call right now.
export async function callToLog(clientId: string) {
  const user = await requireCallAccess(clientId);
  const now = new Date();
  const open =
    (await prisma.amCall.findFirst({ where: { clientId, status: "PENDING", scheduledAt: { lte: now } }, orderBy: { scheduledAt: "asc" }, select: { id: true } })) ??
    (await prisma.amCall.findFirst({ where: { clientId, status: "PENDING" }, orderBy: { scheduledAt: "asc" }, select: { id: true } }));
  if (open) return open.id;
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { accountManagerId: true } });
  const call = await prisma.amCall.create({ data: { clientId, scheduledAt: now, callPersonId: client.accountManagerId ?? (await myUserId(user.clerkId)) } });
  return call.id;
}

// Move a call that hasn't happened yet (inline "next call" edit) — a
// planning change, not a reschedule.
export async function moveCallTime(callId: string, when: string) {
  const call = await callOf(callId);
  await requireCallAccess(call.clientId);
  if (call.status !== "PENDING") throw new Error("Only an upcoming call can be moved");
  const at = whenOrThrow(when);
  if (at <= new Date()) throw new Error("Pick a time in the future (or reschedule it)");
  await moveCall(callId, at);
  revalidatePath("/", "layout");
}

// 🔁 Rescheduled: the call → RESCHEDULED (+ reason), a new PENDING call at
// the new time (lib/am-calls.ts rescheduleCall). Returns the new call's id.
export async function rescheduleCallTo(callId: string, when: string, reason: string) {
  const call = await callOf(callId);
  const user = await requireCallAccess(call.clientId);
  const next = await rescheduleCall(callId, whenOrThrow(when), reason.trim(), user.name);
  revalidatePath("/", "layout");
  return next.id;
}

export type CallLogInput = {
  summary: string;
  nextSteps: string; // one per line
  internalNotes: string; // team only — never shown or sent to the client
  outcome: ClientMood | "";
  nextCallAt: string; // "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD" (the regular time), Sydney
  leadsDiscussed: string[];
  leadsReturned: string[];
  durationMins: string;
  skipEmail: boolean; // "Don't email client"
};

// ✅ Call happened. Returned leads go back to Chase Up (RETURNED_BY_CLIENT +
// write-back), a ContactLog entry, the client's "Weekly status update" email
// (unless skipped), the summary to their Slack channel, the ClickUp task gets
// the summary and is closed, and the next call is booked. Slack / ClickUp /
// email failures never block the save.
export async function logCallHeld(callId: string, input: CallLogInput) {
  const call = await prisma.amCall.findUnique({
    where: { id: callId },
    include: { client: { select: { name: true, slug: true, slackChannelId: true, slackEvents: true, clientType: true, email: true, callTime: true, users: { where: { role: "CLIENT" }, select: { email: true } } } }, callPerson: { select: { name: true } } },
  });
  if (!call) throw new Error("Call not found");
  const user = await requireCallAccess(call.clientId);
  if (call.status !== "PENDING") throw new Error("This call has already been logged");
  if (!input.summary.trim()) throw new Error("Add a short summary of the call");
  const mins = input.durationMins.trim() ? Number(input.durationMins) : null;
  if (mins != null && !(Number.isInteger(mins) && mins > 0 && mins <= 600)) throw new Error("Duration is whole minutes (1–600)");
  const nextCallAt = input.nextCallAt.trim() ? parseCallWhen(input.nextCallAt, call.client.callTime) : null;
  if (input.nextCallAt.trim() && !nextCallAt) throw new Error("The next call date doesn't look right");

  const leads = async (ids: string[]) => prisma.lead.findMany({ where: { id: { in: ids }, clientId: call.clientId, deletedAt: null }, select: { id: true, stage: true } });
  const discussed = (await leads(input.leadsDiscussed)).map((l) => l.id);
  const returnable = (await leads(input.leadsReturned)).filter((l) => isReturn(l.stage, "CHASE_UP")).map((l) => l.id);
  const steps = splitSteps(input.nextSteps);
  const saved = await prisma.amCall.update({
    where: { id: callId },
    data: {
      status: "HELD",
      summary: input.summary.trim(),
      nextSteps: steps,
      internalNotes: input.internalNotes.trim() || null,
      outcome: input.outcome || null,
      nextCallAt,
      leadsDiscussed: discussed,
      leadsReturned: returnable,
      durationMins: mins,
      loggedAt: new Date(),
      submittedBy: user.name,
    },
  });
  for (const id of returnable) await updateLeadStage(id, "CHASE_UP");
  await prisma.contactLog.create({ data: { clientId: call.clientId, contactedAt: call.scheduledAt, method: "meeting", loggedBy: user.name, notes: saved.summary, nextStep: steps.join("\n") || null, nextStepDue: nextCallAt } });

  if (!input.skipEmail) {
    // Numbers are left out while the client's reports are on hold.
    const kpis = (await reportsOnHold(call.clientId)) ? null : (await getMonthToDateVsLast(call.clientId)).current;
    const e = clientCallEmail({ clientName: call.client.name, clientType: call.client.clientType, amName: call.callPerson?.name ?? user.name, scheduledAt: call.scheduledAt, summary: saved.summary!, nextSteps: steps, kpis });
    const sent = await sendActionEmail({
      to: call.client.users.length ? call.client.users.map((u) => u.email) : call.client.email ? [call.client.email] : [],
      type: "call_update",
      clientId: call.clientId,
      refIds: [callId],
      path: `/clients/${call.client.slug}?tab=weekly`,
      ...e,
      button: "View in portal",
      footnote: "You're getting this because Hive Social runs a regular call with you.",
    }).catch((err) => (console.error(`Call update email for ${callId} failed:`, err), false));
    if (sent) await prisma.amCall.update({ where: { id: callId }, data: { emailedToClientAt: new Date() } });
  }
  if (call.client.slackChannelId && parseSlackEvents(call.client.slackEvents).weeklyUpdates) {
    const t = [
      `:telephone_receiver: *Call — ${callDateLabel(call.scheduledAt)}* (${user.name})`,
      saved.summary,
      steps.length ? `*Next steps*\n${steps.map((s) => `• ${s}`).join("\n")}` : null,
      returnable.length ? `${returnable.length} lead${returnable.length === 1 ? "" : "s"} returned to chase up` : null,
    ].filter(Boolean).join("\n\n");
    await queueSlack({ clientId: call.clientId, channel: call.client.slackChannelId, kind: "weekly_call", dedupeKey: `weekly_call:${callId}`, text: t }).catch(() => {});
    kickSlack();
  }
  const update = callTaskUpdate(saved);
  if (call.clickupTaskId && update) await finishTask(call.clickupTaskId, update.description);
  await ensureNextCall(call.clientId, { preferred: nextCallAt });
  await runHealthChecks(call.clientId).catch((e) => console.error("Health checks failed:", e)); // clears AM_CALL_NOT_LOGGED / AM_CALL_MISSED
  revalidatePath("/", "layout");
}

// ❌ Didn't happen: the ClickUp task says why and is closed, AM_CALL_MISSED
// is raised (data health), the admin channel hears about it, no client
// email; the next call is booked.
export async function logCallNotHeld(callId: string, reasonKey: string, text: string) {
  const call = await prisma.amCall.findUnique({ where: { id: callId }, include: { client: { select: { name: true } } } });
  if (!call) throw new Error("Call not found");
  const user = await requireCallAccess(call.clientId);
  if (call.status !== "PENDING") throw new Error("This call has already been logged");
  if (!(reasonKey in NOT_HELD_REASONS)) throw new Error("Say why the call didn't happen");
  const reason = [NOT_HELD_REASONS[reasonKey as keyof typeof NOT_HELD_REASONS], text.trim()].filter(Boolean).join(" — ");
  const saved = await prisma.amCall.update({ where: { id: callId }, data: { status: "NOT_HELD", notHeldReason: reason, loggedAt: new Date(), submittedBy: user.name } });
  const update = callTaskUpdate(saved);
  if (call.clickupTaskId && update) await finishTask(call.clickupTaskId, update.description);
  const admin = process.env.SLACK_ADMIN_CHANNEL;
  if (admin) {
    await queueSlack({ channel: admin, clientId: call.clientId, kind: "meeting_missed", dedupeKey: `meeting_missed:${callId}`, text: `:warning: *${call.client.name}* — the ${callDateLabel(call.scheduledAt)} call didn't happen: ${reason} (${user.name})` }).catch(() => {});
    kickSlack();
  }
  await ensureNextCall(call.clientId);
  await runHealthChecks(call.clientId).catch((e) => console.error("Health checks failed:", e));
  revalidatePath("/", "layout");
}

// Fix a held call's log (the panel's Edit). Nothing is re-sent — no email,
// ClickUp or Slack. The client's ticks stay on the steps whose text is kept.
export async function editCallLog(callId: string, input: Pick<CallLogInput, "summary" | "nextSteps" | "internalNotes" | "outcome" | "durationMins">) {
  const call = await callOf(callId);
  await requireCallAccess(call.clientId);
  if (call.status !== "HELD") throw new Error("Only a held call's log can be edited");
  if (!input.summary.trim()) throw new Error("Add a short summary of the call");
  const mins = input.durationMins.trim() ? Number(input.durationMins) : null;
  if (mins != null && !(Number.isInteger(mins) && mins > 0 && mins <= 600)) throw new Error("Duration is whole minutes (1–600)");
  const steps = splitSteps(input.nextSteps);
  const ticked = new Set(call.stepsDone.map((i) => call.nextSteps[i]));
  await prisma.amCall.update({
    where: { id: callId },
    data: {
      summary: input.summary.trim(),
      nextSteps: steps,
      stepsDone: steps.flatMap((s, i) => (ticked.has(s) ? [i] : [])),
      internalNotes: input.internalNotes.trim() || null,
      outcome: input.outcome || null,
      durationMins: mins,
    },
  });
  revalidatePath("/", "layout");
}

// The client ticks off a next step from a held call (Weekly status tab).
// Only the client's own logins tick; the team sees the ticks.
export async function toggleCallStep(callId: string, index: number, done: boolean) {
  const call = await prisma.amCall.findUnique({ where: { id: callId }, select: { clientId: true, status: true, nextSteps: true, stepsDone: true } });
  if (!call || call.status !== "HELD") throw new Error("Call not found");
  const user = await requireClientAccess(call.clientId);
  if (user.role !== "CLIENT") throw new Error("Only the client ticks off next steps");
  if (!Number.isInteger(index) || index < 0 || index >= call.nextSteps.length) throw new Error("Invalid step");
  const set = new Set(call.stepsDone);
  if (done) set.add(index);
  else set.delete(index);
  await prisma.amCall.update({ where: { id: callId }, data: { stepsDone: Array.from(set).sort((x, y) => x - y) } });
  revalidatePath(`/clients`);
}

// The viewer opened the Weekly status tab — clears its "New" badge.
export async function markWeeklyStatusViewed() {
  const user = await requireUser();
  await prisma.user.updateMany({ where: { clerkId: user.clerkId }, data: { weeklyStatusViewedAt: new Date() } });
}

export async function logContact(clientId: string, formData: FormData) {
  const user = await requireCoach();
  const day = String(formData.get("date") || "");
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const contactedAt = m ? sydneyLocalToDate(Number(m[1]), Number(m[2]), Number(m[3]), 12) : null;
  if (!contactedAt) throw new Error("Pick a date");
  // Calls are logged as structured calls ("Log a call"), not here.
  const method = String(formData.get("type") || "message");
  if (!["meeting", "message"].includes(method)) throw new Error("Invalid contact type");
  const due = String(formData.get("nextStepDue") || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const text = (k: string) => String(formData.get(k) || "").trim() || null;
  await prisma.contactLog.create({
    data: {
      clientId,
      contactedAt,
      method,
      loggedBy: text("who") ?? user.name,
      notes: text("notes"),
      nextStep: text("nextStep"),
      nextStepDue: due ? sydneyLocalToDate(Number(due[1]), Number(due[2]), Number(due[3])) : null,
    },
  });
  revalidatePath(`/clients`);
}

// ── Slack + ClickUp per client (coach only) ─────────────────────────────

// Coach-only: "Create ClickUp folder" — the client's folder (Account /
// Client / Other lists) in the chosen space; HQ's tasks then go to Account.
export async function createClientClickUpFolder(clientId: string, spaceId: string): Promise<{ ok: true; listId: string } | { error: string }> {
  await requireCoach();
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  if (!client) return { error: "Client not found" };
  try {
    const { lists } = await createClientFolder(spaceId, client.name);
    await prisma.client.update({ where: { id: clientId }, data: { clickupListId: lists.Account } });
    revalidatePath(`/clients`);
    return { ok: true, listId: lists.Account };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "ClickUp request failed" };
  }
}

export async function saveClientIntegrations(clientId: string, input: { slackChannelId: string; slackEvents: Record<string, boolean>; clickupListId: string; clickupAssigneeIds?: string[] }) {
  await requireCoach();
  await prisma.client.update({
    where: { id: clientId },
    data: {
      slackChannelId: input.slackChannelId.trim() || null,
      slackEvents: parseSlackEvents(input.slackEvents),
      clickupListId: input.clickupListId.trim() || null,
      ...(input.clickupAssigneeIds ? { clickupAssigneeIds: input.clickupAssigneeIds.filter((id) => /^\d+$/.test(id)) } : {}),
    },
  });
  revalidatePath(`/clients`);
}

// Returns the error instead of throwing so the coach sees Slack's reason.
export async function sendSlackTest(clientId: string): Promise<{ ok: true } | { error: string }> {
  await requireCoach();
  try {
    await queueTestMessage(clientId);
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't post to Slack" };
  }
}

export async function createManualClickUpTask(clientId: string, input: { title: string; description: string; due: string }): Promise<{ ok: true } | { error: string }> {
  const user = await requireCoach();
  const title = input.title.trim();
  if (!title) return { error: "Give the task a title" };
  const m = input.due.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const taskId = await ensureTask(clientId, {
    kind: "manual",
    dedupeKey: `manual:${clientId}:${Date.now()}`,
    title,
    why: `Added by ${user.name} from the client's page in Hive HQ.`,
    description: input.description.trim() || "(no details)",
    dueDate: m ? sydneyLocalToDate(Number(m[1]), Number(m[2]), Number(m[3]), 17) : null,
  });
  if (taskId) return { ok: true };
  const failed = await prisma.clickUpTaskLog.findFirst({ where: { clientId, kind: "manual" }, orderBy: { createdAt: "desc" } });
  return { error: failed?.error ?? "ClickUp isn't set up — add the API key (Settings → Integrations) and pick this client's list" };
}

// ── Playbooks / lessons ──────────────────────────────────────────────────
export async function toggleLessonComplete(clientId: string, lessonId: string, completed: boolean) {
  await requireClientAccess(clientId);
  await prisma.clientLessonProgress.upsert({
    where: { clientId_lessonId: { clientId, lessonId } },
    update: { completedAt: completed ? new Date() : null },
    create: { clientId, lessonId, completedAt: completed ? new Date() : null },
  });
  const { checkAndGrantAwards } = await import("./awards");
  await checkAndGrantAwards(clientId);
  revalidatePath(`/clients`);
}

// ── Integration settings ─────────────────────────────────────────────────
export async function saveIntegrationSettings(formData: FormData) {
  await requireCoach();
  const clickupApiKey = String(formData.get("clickupApiKey") || "").trim();
  const clickupTeamId = String(formData.get("clickupTeamId") || "").trim();
  const crmType = String(formData.get("crmType") || "").trim();
  const crmApiKeyOrUrl = String(formData.get("crmApiKeyOrUrl") || "").trim();

  await prisma.integrationSettings.upsert({
    where: { id: "singleton" },
    update: { clickupApiKey, clickupTeamId, crmType, crmApiKeyOrUrl },
    create: { id: "singleton", clickupApiKey, clickupTeamId, crmType, crmApiKeyOrUrl },
  });
  revalidatePath("/settings");
}

// Forgets the "Add to Slack" token (Posts fall back to SLACK_BOT_TOKEN, if set).
export async function disconnectSlack() {
  await requireAdmin();
  await prisma.integrationSettings.updateMany({ where: { id: "singleton" }, data: { slackBotToken: null, slackTeamName: null } });
  revalidatePath("/settings");
}

// ── Playbooks — modules & lessons ────────────────────────────────────────
export async function createModule(formData: FormData) {
  await requireCoach();
  const title = String(formData.get("title") || "").trim();
  if (!title) throw new Error("Module title is required");

  const count = await prisma.module.count();
  await prisma.module.create({ data: { title, order: count } });
  revalidatePath("/settings");
  revalidatePath("/clients");
}

export type CreateLessonState = { error: string } | null;

// Checks the URL is actually reachable (not just well-formed) before saving
// it — malformed input never even reaches here since the form field is
// type="url" (native browser validation). A dead link would otherwise sit
// silently in a lesson until a client clicks it and hits a 404.
async function checkLinkReachable(url: string): Promise<string | null> {
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(6000) });
    // Some hosts (incl. YouTube on some paths) reject HEAD — retry with GET
    // before concluding anything, rather than false-flagging a good link.
    if (res.status === 405) {
      res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(6000) });
    }
    if (res.status === 404) return "That link returns a 404 — please update it or paste the correct one.";
    return null;
  } catch {
    return "Couldn't reach that link (connection failed or timed out) — please check and paste the correct one.";
  }
}

export async function createLesson(_prev: CreateLessonState, formData: FormData): Promise<CreateLessonState> {
  await requireCoach();
  const moduleId = String(formData.get("moduleId") || "");
  const title = String(formData.get("title") || "").trim();
  const videoUrl = String(formData.get("videoUrl") || "").trim();
  const content = String(formData.get("content") || "").trim();
  if (!moduleId) return { error: "Module is required" };
  if (!title) return { error: "Lesson title is required" };

  if (videoUrl) {
    const linkError = await checkLinkReachable(videoUrl);
    if (linkError) return { error: linkError };
  }

  const count = await prisma.lesson.count({ where: { moduleId } });
  await prisma.lesson.create({
    data: { moduleId, title, videoUrl: videoUrl || null, content: content || null, order: count },
  });
  revalidatePath("/settings");
  revalidatePath("/clients");
  return null;
}

export type CreateClientState = { error: string } | { slug: string } | null;

// Returns a result object instead of throwing/redirecting — lets the modal
// (AddClientModal, used both on /clients and in Settings) show a real error
// message via useFormState instead of the request just failing silently.
export async function createClient(_prev: CreateClientState, formData: FormData): Promise<CreateClientState> {
  await requireCoach();
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const scope = String(formData.get("scope") || "").trim();
  const driveLink = String(formData.get("driveLink") || "").trim();
  const status = String(formData.get("status") || "ONBOARDING") as "ACTIVE" | "ONBOARDING" | "CHURNED";
  // The automation setup, all optional — a blank one just stays off for
  // this client until it's added on their page (see SetupChecklist).
  const text = (k: string) => String(formData.get(k) || "").trim();
  const clientType = (["TRADE", "SERVICE", "OTHER"].includes(text("clientType")) ? text("clientType") : "OTHER") as "TRADE" | "SERVICE" | "OTHER";
  const day = text("startDate").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const startDate = day ? sydneyLocalToDate(Number(day[1]), Number(day[2]), Number(day[3])) : null;
  const email = text("email").toLowerCase();
  const slackChannelId = text("slackChannelId").toUpperCase();
  const accountManagerId = text("accountManagerId") || null;
  const callDay = (WEEKDAYS.includes(text("callDay") as Weekday) ? text("callDay") : "FRIDAY") as Weekday;
  const callTime = isCallTime(text("callTime")) ? text("callTime") : "10:00";
  const callFrequency = (text("callFrequency") === "FORTNIGHTLY" ? "FORTNIGHTLY" : "WEEKLY") as CallFrequency;
  const clickupMode = text("clickupMode");
  const clickupAssigneeIds = formData.getAll("clickupAssigneeIds").map(String).filter((id) => /^\d+$/.test(id));

  if (!name) return { error: "Client name is required" };
  if (driveLink && !/^https:\/\/(?:drive|docs)\.google\.com\//.test(driveLink)) {
    return { error: "That doesn't look like a Google Drive/Docs/Sheets/Slides link — leave it blank to skip for now." };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That client email doesn't look right — fix it or leave it blank." };
  if (slackChannelId && !/^[CG][A-Z0-9]{6,}$/.test(slackChannelId)) {
    return { error: "A Slack channel ID looks like C0123ABCD (channel name → About → bottom) — not the channel's name." };
  }
  if (accountManagerId) {
    const am = await prisma.user.findUnique({ where: { id: accountManagerId }, select: { role: true } });
    if (!am || am.role === "CLIENT") return { error: "Pick a team member as the account manager" };
  }

  try {
    // Double-submit guard: the same name created seconds ago is the same
    // click twice (or a retry), not a second client — hand back the first.
    // ponytail: time-window heuristic, not a true idempotency key; a real
    // second client with an identical name just needs to wait 30s.
    const justCreated = await prisma.client.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, joinedAt: { gte: new Date(Date.now() - 30_000) } },
    });
    if (justCreated) return { slug: justCreated.slug };

    let slug = slugify(name);
    const existingSlug = await prisma.client.findUnique({ where: { slug } });
    if (existingSlug) slug = `${slug}-${Date.now().toString(36)}`;

    const client = await prisma.client.create({
      data: {
        name,
        slug,
        description: description || null,
        scope: scope || null,
        gameplanFigmaLink: driveLink || null,
        status,
        isActive: status !== "CHURNED",
        clientType,
        startDate,
        email: email || null,
        slackChannelId: slackChannelId || null,
        accountManagerId,
        callDay,
        callTime,
        callFrequency,
        clickupAssigneeIds,
        clickupListId: clickupMode === "existing" ? text("clickupListId") || null : null,
      },
    });
    await getOrCreateClientReferralLink(client.id, client.name);
    // Their first account-manager call (lib/am-calls.ts).
    await ensureNextCall(client.id).catch((e) => console.error("First call booking failed:", e));

    // Their own ClickUp lists (Account / Client / Other). A ClickUp problem
    // never stops the client being created — the setup checklist shows it.
    if (clickupMode === "create" && text("clickupTarget")) {
      try {
        const { lists } = await createClientFolder(text("clickupTarget"), client.name);
        await prisma.client.update({ where: { id: client.id }, data: { clickupListId: lists.Account } });
      } catch (e) {
        console.error(`ClickUp lists for new client ${client.name} failed:`, e);
      }
    }
    await runHealthChecks(client.id).catch(() => {});

    revalidatePath("/clients");
    revalidatePath("/settings");
    return { slug: client.slug };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create the client" };
  }
}

// Coach-only, applies the same status to every selected client in one go —
// the "Bulk Edit" action on the /clients grid.
// "ARCHIVE" archives them instead. Not Active / archived clients lose their
// booked calls; set back to Active, they're booked again by the next cron.
export async function bulkUpdateClientStatus(clientIds: string[], status: string) {
  await requireCoach();
  if (clientIds.length === 0) return;
  if (!["ACTIVE", "ONBOARDING", "CHURNED", "ARCHIVE"].includes(status)) throw new Error("Invalid status");
  if (status === "ARCHIVE") {
    await prisma.client.updateMany({ where: { id: { in: clientIds } }, data: { archivedAt: new Date() } });
  } else {
    await prisma.client.updateMany({
      where: { id: { in: clientIds } },
      data: { status: status as never, isActive: status !== "CHURNED" },
    });
  }
  if (status === "ARCHIVE" || status === "CHURNED") await dropFutureCalls(clientIds);
  else for (const id of clientIds) await ensureNextCall(id).catch(() => null);
  revalidatePath("/", "layout");
}

// Archiving is independent of status — hides the client from every default
// list/dashboard view (see the archivedAt: null filters) without touching
// ACTIVE/ONBOARDING/CHURNED or deleting anything. Unarchive just clears it.
export async function archiveClient(clientId: string) {
  await requireCoach();
  await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } });
  await dropFutureCalls([clientId]);
  revalidatePath("/", "layout");
}

export async function unarchiveClient(clientId: string) {
  await requireCoach();
  await prisma.client.update({ where: { id: clientId }, data: { archivedAt: null } });
  await ensureNextCall(clientId).catch(() => null);
  revalidatePath("/", "layout");
}

// Irreversible — only ever offered from the archived view (also enforced
// here, not just in the UI). Deletes every row this client owns across the
// schema, in FK dependency order, in one transaction so it can't half-fail.
// Clerk logins are deleted first since that's an external call that can't
// be part of the DB transaction; best-effort so an already-orphaned Clerk
// account never blocks the local cleanup.
export async function deleteClientPermanently(clientId: string) {
  await requireCoach();

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return;
  if (!client.archivedAt) throw new Error("Archive this client before deleting it permanently.");

  const [clientUsers, leads, referralLink] = await Promise.all([
    prisma.user.findMany({ where: { clientId } }),
    prisma.lead.findMany({ where: { clientId }, select: { id: true } }),
    prisma.referralLink.findUnique({ where: { clientId } }),
  ]);

  const clerk = await getClerkAdminClient();
  await Promise.all(clientUsers.map((u) => clerk.users.deleteUser(u.clerkId).catch(() => {})));

  const leadIds = leads.map((l) => l.id);

  await prisma.$transaction([
    ...(leadIds.length
      ? [
          prisma.leadActivity.deleteMany({ where: { leadId: { in: leadIds } } }),
          prisma.leadNote.deleteMany({ where: { leadId: { in: leadIds } } }),
          prisma.leadStageEvent.deleteMany({ where: { leadId: { in: leadIds } } }),
          prisma.leadNoteEvent.deleteMany({ where: { leadId: { in: leadIds } } }),
          prisma.writeBackJob.deleteMany({ where: { leadId: { in: leadIds } } }),
          prisma.leadReminder.deleteMany({ where: { leadId: { in: leadIds } } }),
        ]
      : []),
    prisma.lead.deleteMany({ where: { clientId } }),
    prisma.clientOnboardingStep.deleteMany({ where: { clientId } }),
    prisma.clientLessonProgress.deleteMany({ where: { clientId } }),
    prisma.adCampaign.deleteMany({ where: { clientId } }),
    prisma.clientAward.deleteMany({ where: { clientId } }),
    prisma.clientSheet.deleteMany({ where: { clientId } }),
    prisma.dataAlert.deleteMany({ where: { clientId } }),
    prisma.weeklyUpdate.deleteMany({ where: { clientId } }),
    prisma.slackPostLog.deleteMany({ where: { clientId } }),
    prisma.clickUpTaskLog.deleteMany({ where: { clientId } }),
    prisma.syncReconciliation.deleteMany({ where: { clientId } }),
    prisma.leadReminder.deleteMany({ where: { clientId } }),
    prisma.clientCycle.deleteMany({ where: { clientId } }),
    prisma.amCall.deleteMany({ where: { clientId } }),
    prisma.emailLog.deleteMany({ where: { clientId } }),
    prisma.contract.deleteMany({ where: { clientId } }),
    prisma.contactLog.deleteMany({ where: { clientId } }),
    prisma.adSpendDaily.deleteMany({ where: { clientId } }),
    prisma.revenueMonthly.deleteMany({ where: { clientId } }),
    prisma.session.deleteMany({ where: { clientId } }),
    prisma.progressNote.deleteMany({ where: { clientId } }),
    prisma.payment.deleteMany({ where: { clientId } }),
    prisma.task.deleteMany({ where: { clientId } }),
    prisma.user.deleteMany({ where: { clientId } }),
    // A referral is its own record (a prospect, not this client's data) —
    // unlink it rather than deleting it, then remove the now-orphaned link.
    ...(referralLink
      ? [
          prisma.referral.updateMany({ where: { referralLinkId: referralLink.id }, data: { referralLinkId: null } }),
          prisma.referralLink.delete({ where: { id: referralLink.id } }),
        ]
      : []),
    prisma.client.delete({ where: { id: clientId } }),
  ]);

  revalidatePath("/clients");
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

// ── Users / logins (coach-only) ──────────────────────────────────────────
// Creates the Clerk account AND the app-side profile in one go. The temp
// password is shown once on screen — the user should change it after first
// login (Clerk's account settings UI handles that, not built here).
export async function createUser(formData: FormData) {
  const me = await requireCoach();

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "CLIENT") as "ADMIN" | "COACH" | "CLIENT" | "AGENT";
  if (!["ADMIN", "COACH", "CLIENT", "AGENT"].includes(role)) throw new Error("Invalid role");
  if (role === "ADMIN" && !me.isAdmin) throw new Error("Only an admin can create another admin");
  const clientId = String(formData.get("clientId") || "") || null;

  if (!name) throw new Error("Name is required");
  if (!email) throw new Error("Email is required");
  if (role === "CLIENT" && !clientId) throw new Error("A client user must be linked to a client");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("A user with that email already exists");

  // Needed for middleware/lib/auth.ts, which read role+clientSlug straight
  // off the Clerk session's publicMetadata rather than hitting Prisma.
  let clientSlug: string | null = null;
  if (role === "CLIENT" && clientId) {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { slug: true } });
    if (!client) throw new Error("Client not found");
    clientSlug = client.slug;
  }

  // Clerk's password policy on this instance requires 15+ characters —
  // 20 gives comfortable headroom above that (and above any other Clerk
  // instance's policy) without needing to special-case a minimum here.
  const tempPassword = randomCode(20);
  const clerk = await getClerkAdminClient();

  const [firstName, ...rest] = name.split(" ");
  const lastName = rest.join(" ") || undefined;
  // Some Clerk instances require a username even when email is the primary
  // identifier. Auto-generate one so this works either way — safe to remove
  // the `username` field below once you've turned Username off in the
  // Clerk dashboard (Configure → Email, Phone, Username).
  const username = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "") + "_" + Math.floor(Math.random() * 10000);

  let clerkUser;
  try {
    clerkUser = await clerk.users.createUser({
      emailAddress: [email],
      password: tempPassword,
      username,
      firstName,
      lastName,
      skipPasswordChecks: false,
      // Set synchronously (rather than waiting on the Clerk webhook) so the
      // very first request this person makes already carries role/clientId/
      // clientSlug in their session claims — middleware.ts and lib/auth.ts
      // both read straight off this instead of querying Prisma.
      publicMetadata: {
        role,
        clientId: role === "CLIENT" ? clientId : undefined,
        clientSlug: role === "CLIENT" ? clientSlug : undefined,
        name,
      },
    });
  } catch (e: unknown) {
    const message =
      (e as { errors?: { message?: string }[] })?.errors?.[0]?.message ||
      (e instanceof Error ? e.message : "Failed to create the login");
    throw new Error(message);
  }

  try {
    await prisma.user.create({
      data: {
        clerkId: clerkUser.id,
        email,
        name,
        role,
        clientId: role === "CLIENT" ? clientId : null,
      },
    });
  } catch (e) {
    // Roll back the Clerk account if the app-side profile fails, so we don't
    // end up with an orphaned login that has no role/client.
    await clerk.users.deleteUser(clerkUser.id);
    throw e;
  }

  revalidatePath("/settings");
  return { email, tempPassword };
}

// Coach-only: a team member's ClickUp user, for assigning weekly call tasks.
export async function saveUserClickUp(userId: string, clickupUserId: string | null) {
  await requireCoach();
  await prisma.user.update({ where: { id: userId }, data: { clickupUserId: clickupUserId?.trim() || null } });
  revalidatePath("/settings");
}

export async function deleteUser(userId: string) {
  const me = await requireCoach();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  if (user.role === "ADMIN" && !me.isAdmin) throw new Error("Only an admin can remove an admin");

  const clerk = await getClerkAdminClient();
  await clerk.users.deleteUser(user.clerkId);
  await prisma.user.delete({ where: { id: userId } });

  revalidatePath("/settings");
}

// ── Sessions ──────────────────────────────────────────────────────────────
export async function createSession(formData: FormData) {
  const clientId = String(formData.get("clientId") || "");
  const scheduledAtRaw = String(formData.get("scheduledAt") || "");
  const durationMin = Number(formData.get("durationMin") || 45);
  const notes = String(formData.get("notes") || "").trim();

  if (!clientId) throw new Error("Choose a client");
  if (!scheduledAtRaw) throw new Error("Choose a date and time");

  // A client can only book against their own record; a coach can book for anyone.
  await requireClientAccess(clientId);

  await prisma.session.create({
    data: {
      clientId,
      scheduledAt: new Date(scheduledAtRaw),
      durationMin: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 45,
      notes: notes || null,
    },
  });

  revalidatePath("/sessions");
  revalidatePath("/clients");
}

export async function updateSessionStatus(id: string, status: string) {
  const session = await prisma.session.findUnique({ where: { id }, select: { clientId: true } });
  if (!session) throw new Error("Session not found");
  await requireClientAccess(session.clientId);

  await prisma.session.update({ where: { id }, data: { status: status as never } });

  revalidatePath("/sessions");
  revalidatePath("/clients");
}
