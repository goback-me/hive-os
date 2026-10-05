import { Webhook } from "svix";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Register this URL in the Clerk Dashboard → Webhooks:
//   https://<your-domain>/api/webhooks/clerk
// Subscribe to: user.created, user.updated, user.deleted
// Copy the "Signing Secret" it gives you into CLERK_WEBHOOK_SECRET in .env
//
// This keeps the Prisma `User` table (used by Settings → Team, and
// anywhere else the app wants a local join to a user) as a read-model
// mirror of Clerk — Clerk itself remains the source of truth for auth
// and for role/clientId (stored in publicMetadata, see lib/auth.ts and
// lib/actions.ts createUser, which sets it directly at creation time so
// this webhook is a mirror/fallback rather than the only path).
export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CLERK_WEBHOOK_SECRET not configured" }, { status: 500 });
  }

  const headerList = await headers();
  const svixId = headerList.get("svix-id");
  const svixTimestamp = headerList.get("svix-timestamp");
  const svixSignature = headerList.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const body = await req.text();
  let event: any;
  try {
    event = new Webhook(secret).verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const type = event.type as string;
  const data = event.data;

  if (type === "user.created" || type === "user.updated") {
    const email =
      data.email_addresses?.find((e: any) => e.id === data.primary_email_address_id)?.email_address ??
      data.email_addresses?.[0]?.email_address;
    const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || email || "Unnamed";
    const meta = (data.public_metadata ?? {}) as { role?: "ADMIN" | "COACH" | "CLIENT" | "AGENT"; clientId?: string };

    if (email && meta.role) {
      await prisma.user.upsert({
        where: { clerkId: data.id },
        update: { email, name, role: meta.role, clientId: meta.clientId ?? null },
        create: {
          clerkId: data.id,
          email,
          name,
          role: meta.role,
          clientId: meta.clientId ?? null,
        },
      });
    }
  }

  if (type === "user.deleted") {
    await prisma.user.deleteMany({ where: { clerkId: data.id } });
  }

  return NextResponse.json({ received: true });
}
