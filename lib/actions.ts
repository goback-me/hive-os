"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// ── Tasks (Kanban) ────────────────────────────────────────────────────
export async function toggleTask(taskId: string, status: "TODO" | "DONE") {
  await prisma.task.update({ where: { id: taskId }, data: { status } });
}

export async function createTask(clientId: string, title: string) {
  const task = await prisma.task.create({
    data: { clientId, title, status: "TODO" },
  });
  return { id: task.id, title: task.title, status: task.status };
}

// ── Clients ────────────────────────────────────────────────────────────
function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function createClient(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const website = String(formData.get("website") || "").trim();
  const contact = String(formData.get("contact") || "").trim();
  const budget = formData.get("budget") ? Number(formData.get("budget")) : null;

  if (!name) throw new Error("Client name is required");

  let slug = slugify(name);
  const existing = await prisma.client.findUnique({ where: { slug } });
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  const client = await prisma.client.create({
    data: {
      name,
      slug,
      isActive: true,
    },
  });

  // Store the initial monthly budget as this month's contract value if provided
  if (budget) {
    const now = new Date();
    await prisma.contract.create({
      data: {
        clientId: client.id,
        startDate: now,
        endDate: new Date(now.getFullYear(), now.getMonth() + 12, now.getDate()),
        status: "ACTIVE",
        monthlyValue: budget,
      },
    });
  }

  // website/contact aren't in the schema yet — logged as a contact log entry
  // so the info isn't silently dropped
  if (website || contact) {
    await prisma.contactLog.create({
      data: {
        clientId: client.id,
        contactedAt: new Date(),
        method: "onboarding",
        notes: [contact && `Contact: ${contact}`, website && `Website: ${website}`]
          .filter(Boolean)
          .join(" | "),
        loggedBy: "Adeel",
      },
    });
  }

  revalidatePath("/clients");
  redirect(`/clients/${client.slug}`);
}

// ── Referrals ──────────────────────────────────────────────────────────
export async function createReferral(formData: FormData) {
  const referrerName = String(formData.get("referrerName") || "").trim();
  const businessName = String(formData.get("businessName") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!referrerName || !businessName || !email) {
    throw new Error("Referrer name, business name, and email are required");
  }

  await prisma.referral.create({
    data: { referrerName, businessName, email, notes: notes || null },
  });

  revalidatePath("/referrals");
}

// ── Team (Settings page) ─────────────────────────────────────────────
// Note: this creates a real team member record so they show up in the
// roster, but there's no invite email / password-setup flow yet — that
// needs a real auth system wired up before it's usable for actual login.
export async function inviteMember(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const title = String(formData.get("title") || "").trim();

  if (!name || !email) throw new Error("Name and email are required");

  await prisma.user.create({
    data: {
      name,
      email,
      title: title || null,
      role: "ADMIN",
      passwordHash: "PENDING_INVITE", // placeholder until real auth/invite flow exists
    },
  });

  revalidatePath("/settings");
}

export async function updateReferralStatus(
  id: string,
  status: "PENDING" | "APPROVED" | "REJECTED",
  payoutAmount?: number
) {
  await prisma.referral.update({
    where: { id },
    data: { status, ...(payoutAmount ? { payoutAmount } : {}) },
  });
  revalidatePath("/referrals");
}
