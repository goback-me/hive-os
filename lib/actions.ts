"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireCoach, requireClientAccess } from "@/lib/auth";
import { getClerkAdminClient } from "@/lib/clerk-admin";
import { syncLeadsFromSheet } from "@/lib/lead-sync";
import { stageTimestampPatch } from "@/lib/lead-status";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ── Referral pipeline ──────────────────────────────────────────────────
export async function updateReferralStage(id: string, stage: string) {
  await prisma.referral.update({ where: { id }, data: { stage: stage as never } });
  revalidatePath("/referrals");
}

export async function createReferral(formData: FormData) {
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
  const existing = await prisma.referralLink.findUnique({ where: { clientId } });
  if (existing) return existing;

  let code = randomCode();
  while (await prisma.referralLink.findUnique({ where: { code } })) {
    code = randomCode();
  }
  return prisma.referralLink.create({ data: { clientId, label: `${clientLabel} referrals`, code } });
}

// Public submission — used by the /refer/[code] page, no auth required
export async function submitPublicReferral(code: string, formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const source = String(formData.get("source") || "").trim();
  const note = String(formData.get("note") || "").trim();
  if (!name) throw new Error("Name is required");

  const link = await prisma.referralLink.findUnique({ where: { code } });

  await prisma.referral.create({
    data: {
      name,
      source: source || null,
      note: note || null,
      stage: "INTRODUCED",
      referralLinkId: link?.id ?? null,
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
export async function syncClientLeads(clientId: string) {
  await requireClientAccess(clientId);
  const summary = await syncLeadsFromSheet(clientId);
  revalidatePath(`/clients`);
  return summary;
}

// A manual status change never gets clobbered by a later sync (see
// lib/lead-sync.ts) — statusManuallySetAt marks that this lead is now
// coach/client-owned, not sheet-owned, for its status field only.
export async function updateLeadStatus(leadId: string, status: string, value?: number) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error("Lead not found");
  const user = await requireClientAccess(lead.clientId);

  await prisma.leadActivity.create({
    data: {
      leadId,
      fromStatus: lead.status,
      toStatus: status as never,
      value: value ?? null,
      changedBy: user.name,
    },
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: status as never,
      statusManuallySetAt: new Date(),
      ...stageTimestampPatch(lead, status as never),
      ...(value !== undefined ? { value } : {}),
    },
  });
  revalidatePath(`/clients`);
}

// A coach or the lead's own client can leave a follow-up note — same
// access rule as ProgressNote, just scoped to one lead instead of the client.
export async function addLeadNote(leadId: string, formData: FormData) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clientId: true } });
  if (!lead) throw new Error("Lead not found");
  const user = await requireClientAccess(lead.clientId);

  const note = String(formData.get("note") || "").trim();
  if (!note) throw new Error("Note can't be empty");

  await prisma.leadNote.create({ data: { leadId, note, createdBy: user.name } });
  revalidatePath(`/clients`);
}

// ── Gameplan (Drive embed) ───────────────────────────────────────────────
export async function saveGameplanLink(clientId: string, formData: FormData) {
  await requireClientAccess(clientId);
  const link = String(formData.get("figmaLink") || "").trim();
  await prisma.client.update({ where: { id: clientId }, data: { gameplanFigmaLink: link || null } });
  revalidatePath(`/clients`);
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

  if (!name) return { error: "Client name is required" };
  if (driveLink && !/^https:\/\/(?:drive|docs)\.google\.com\//.test(driveLink)) {
    return { error: "That doesn't look like a Google Drive/Docs/Sheets/Slides link — leave it blank to skip for now." };
  }

  try {
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
      },
    });
    await getOrCreateClientReferralLink(client.id, client.name);

    revalidatePath("/clients");
    revalidatePath("/settings");
    return { slug: client.slug };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create the client" };
  }
}

// Coach-only, applies the same status to every selected client in one go —
// the "Bulk Edit" action on the /clients grid.
export async function bulkUpdateClientStatus(clientIds: string[], status: string) {
  await requireCoach();
  if (clientIds.length === 0) return;
  await prisma.client.updateMany({
    where: { id: { in: clientIds } },
    data: { status: status as never, isActive: status !== "CHURNED" },
  });
  revalidatePath("/clients");
}

// Archiving is independent of status — hides the client from every default
// list/dashboard view (see the archivedAt: null filters) without touching
// ACTIVE/ONBOARDING/CHURNED or deleting anything. Unarchive just clears it.
export async function archiveClient(clientId: string) {
  await requireCoach();
  await prisma.client.update({ where: { id: clientId }, data: { archivedAt: new Date() } });
  revalidatePath("/clients");
  revalidatePath("/leads");
}

export async function unarchiveClient(clientId: string) {
  await requireCoach();
  await prisma.client.update({ where: { id: clientId }, data: { archivedAt: null } });
  revalidatePath("/clients");
  revalidatePath("/leads");
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
        ]
      : []),
    prisma.lead.deleteMany({ where: { clientId } }),
    prisma.clientOnboardingStep.deleteMany({ where: { clientId } }),
    prisma.clientLessonProgress.deleteMany({ where: { clientId } }),
    prisma.adCampaign.deleteMany({ where: { clientId } }),
    prisma.clientAward.deleteMany({ where: { clientId } }),
    prisma.clientSheet.deleteMany({ where: { clientId } }),
    prisma.contract.deleteMany({ where: { clientId } }),
    prisma.contactLog.deleteMany({ where: { clientId } }),
    prisma.adSpendDaily.deleteMany({ where: { clientId } }),
    prisma.revenueMonthly.deleteMany({ where: { clientId } }),
    prisma.session.deleteMany({ where: { clientId } }),
    prisma.progressNote.deleteMany({ where: { clientId } }),
    prisma.payment.deleteMany({ where: { clientId } }),
    prisma.needsActionItem.deleteMany({ where: { clientId } }),
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
  await requireCoach();

  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "CLIENT") as "COACH" | "CLIENT";
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

  const tempPassword = randomCode(14);
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

export async function deleteUser(userId: string) {
  await requireCoach();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;

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

// Swarm tracking integration removed along with the client-page Tracking
// tab. lib/swarm-config.ts is no longer imported anywhere in this app.