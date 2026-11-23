import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { getClerkAdminClient } from "@/lib/clerk-admin";
import { prisma } from "@/lib/prisma";
import { canAccessClient } from "@/lib/access";
import { DEV_USER, devAuthBypass } from "@/lib/dev-auth";

export type CurrentUser = {
  id: string; // Clerk user id — app-side User.id is looked up separately where needed (e.g. Settings)
  clerkId: string;
  email: string;
  name: string;
  // ADMIN accounts come through as role "COACH" with isAdmin set — ADMIN is a
  // superset of COACH, so every existing coach check lets an admin through
  // without each call site knowing about it. requireAdmin() is the only gate
  // that needs isAdmin itself.
  role: "COACH" | "CLIENT";
  isAdmin: boolean;
  // AGENT accounts are team members (role "COACH") limited to the clients
  // they run the weekly call for — agentClientIds. requireCoach() still turns
  // them away: agency-wide and coach-only actions aren't theirs.
  isAgent: boolean;
  agentClientIds: string[];
  clientId: string | null;
  clientSlug: string | null;
  // Set while an admin previews the app as someone else ("View as"): who.
  viewingAs?: string;
};

// "View as" (admins only): the cookie holds "client:<Client.id>" (that
// client's portal) or "user:<User.id>" (a team member). Only honoured when
// the real signed-in account is an admin — anyone else's cookie is ignored.
export const VIEW_AS_COOKIE = "hq_view_as";
export const parseViewAs = (v: string | undefined) => {
  const m = v?.match(/^(client|user):([A-Za-z0-9_-]{1,64})$/);
  return m ? { kind: m[1] as "client" | "user", id: m[2] } : null;
};

// Adapted from Hive OS: role/clientId/clientSlug live in Clerk's
// publicMetadata (set the moment an account is created — see
// lib/actions.ts createUser — and mirrored by the Clerk webhook,
// app/api/webhooks/clerk/route.ts, if it's ever changed from the Clerk
// dashboard directly). This avoids a Prisma round trip on every request;
// middleware.ts is what actually redirects unauthenticated/unassigned
// visitors away, this is the last-line guard for pages/actions it
// doesn't cover. `cache()` dedupes this within a single request.
export const getRealUser = cache(async (): Promise<CurrentUser | null> => {
  if (devAuthBypass()) return DEV_USER;
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;

  type Metadata = { role?: "ADMIN" | "COACH" | "CLIENT" | "AGENT"; clientId?: string; clientSlug?: string; name?: string };
  let metadata = (sessionClaims?.publicMetadata ?? {}) as Metadata;
  let email = sessionClaims?.email as string | undefined;
  let firstName = sessionClaims?.firstName as string | undefined;
  let lastName = sessionClaims?.lastName as string | undefined;

  // Some Clerk instances' default session token doesn't include
  // publicMetadata at all (that requires customizing the session token in
  // Clerk Dashboard → Sessions) — falls back to the Backend API, which
  // always has the full user object, so this works regardless of whether
  // that's been configured on this particular Clerk project.
  if (!metadata.role) {
    const clerk = await getClerkAdminClient();
    const user = await clerk.users.getUser(userId).catch(() => null);
    if (user) {
      metadata = (user.publicMetadata ?? {}) as Metadata;
      email = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
      firstName = user.firstName ?? undefined;
      lastName = user.lastName ?? undefined;
    }
  }

  // Logged into Clerk but no role assigned yet — treat as unauthenticated.
  // (Shouldn't happen in normal use: accounts are only created via the
  // Settings "Create user" flow, which sets metadata at creation time.)
  if (!metadata.role) return null;

  const name = metadata.name || [firstName, lastName].filter(Boolean).join(" ") || email || "Unnamed";
  const isAgent = metadata.role === "AGENT";
  const agentClientIds = isAgent
    ? ((await prisma.user.findUnique({ where: { clerkId: userId }, select: { callClients: { where: { archivedAt: null }, select: { id: true } } } }))?.callClients.map((c) => c.id) ?? [])
    : [];

  return {
    id: userId,
    clerkId: userId,
    email: email ?? "",
    name,
    role: metadata.role === "CLIENT" ? "CLIENT" : "COACH",
    isAdmin: metadata.role === "ADMIN",
    isAgent,
    agentClientIds,
    clientId: metadata.clientId ?? null,
    clientSlug: metadata.clientSlug ?? null,
  };
});

// Who the app treats as signed in: the real account, or — for an admin
// using "View as" — the client or team member they're previewing, with that
// person's exact access. Changes made meanwhile are named "<admin> as <who>".
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const real = await getRealUser();
  if (!real?.isAdmin) return real;
  const v = parseViewAs(cookies().get(VIEW_AS_COOKIE)?.value);
  if (!v) return real;
  if (v.kind === "client") {
    const c = await prisma.client.findUnique({ where: { id: v.id }, select: { id: true, slug: true, name: true } });
    if (!c) return real;
    return { ...real, name: `${real.name} as ${c.name}`, role: "CLIENT", isAdmin: false, isAgent: false, agentClientIds: [], clientId: c.id, clientSlug: c.slug, viewingAs: c.name };
  }
  const u = await prisma.user.findUnique({
    where: { id: v.id },
    select: { clerkId: true, email: true, name: true, role: true, callClients: { where: { archivedAt: null }, select: { id: true } } },
  });
  if (!u || u.role === "ADMIN" || u.role === "CLIENT") return real;
  return {
    id: u.clerkId,
    clerkId: u.clerkId,
    email: u.email,
    name: `${real.name} as ${u.name}`,
    role: "COACH",
    isAdmin: false,
    isAgent: u.role === "AGENT",
    agentClientIds: u.role === "AGENT" ? u.callClients.map((c) => c.id) : [],
    clientId: null,
    clientSlug: null,
    viewingAs: u.name,
  };
});

/** Require any logged-in user. Redirects to /login if not authenticated. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Require a COACH or ADMIN. Sends clients back to their own dashboard instead of leaking a 403; agents to their client list. */
export async function requireCoach(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "COACH") redirect("/dashboard");
  if (user.isAgent) redirect("/clients");
  return user;
}

/** Require a team member — COACH, ADMIN or AGENT. */
export async function requireTeam(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "COACH") redirect("/dashboard");
  return user;
}

export { canAccessClient };

/** Require an ADMIN — agency-level controls (Google connection, creating admins). */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireCoach();
  if (!user.isAdmin) redirect("/dashboard");
  return user;
}

/**
 * Require access to a specific client's data. A COACH/ADMIN can access any client;
 * a CLIENT may only access their own. Call this at the top of every page/
 * action that takes a clientId or client slug.
 */
export async function requireClientAccess(clientId: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (!canAccessClient(user, clientId)) redirect(user.role === "COACH" ? "/clients" : "/dashboard");
  return user;
}

/**
 * Prisma `where` fragment that scopes any client-scoped model to what the
 * current user is allowed to see: `{}` (no restriction) for a COACH, or
 * `{ clientId: <their own id> }` for a CLIENT. Spread this into `where`
 * clauses, e.g. `prisma.task.findMany({ where: { ...scope, status: "DONE" } })`.
 */
export function clientScopeWhere(user: CurrentUser): { clientId?: string | { in: string[] } } {
  if (user.role === "CLIENT") return { clientId: user.clientId ?? "__none__" };
  return user.isAgent ? { clientId: { in: user.agentClientIds } } : {};
}
