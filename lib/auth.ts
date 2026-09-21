import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { getClerkAdminClient } from "@/lib/clerk-admin";

export type CurrentUser = {
  id: string; // Clerk user id — app-side User.id is looked up separately where needed (e.g. Settings)
  clerkId: string;
  email: string;
  name: string;
  role: "COACH" | "CLIENT";
  clientId: string | null;
  clientSlug: string | null;
};

// Adapted from Hive OS: role/clientId/clientSlug live in Clerk's
// publicMetadata (set the moment an account is created — see
// lib/actions.ts createUser — and mirrored by the Clerk webhook,
// app/api/webhooks/clerk/route.ts, if it's ever changed from the Clerk
// dashboard directly). This avoids a Prisma round trip on every request;
// middleware.ts is what actually redirects unauthenticated/unassigned
// visitors away, this is the last-line guard for pages/actions it
// doesn't cover. `cache()` dedupes this within a single request.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;

  type Metadata = { role?: "COACH" | "CLIENT"; clientId?: string; clientSlug?: string; name?: string };
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

  return {
    id: userId,
    clerkId: userId,
    email: email ?? "",
    name,
    role: metadata.role,
    clientId: metadata.clientId ?? null,
    clientSlug: metadata.clientSlug ?? null,
  };
});

/** Require any logged-in user. Redirects to /login if not authenticated. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Require a COACH (admin). Sends clients back to their own dashboard instead of leaking a 403. */
export async function requireCoach(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "COACH") redirect("/dashboard");
  return user;
}

/**
 * Require access to a specific client's data. A COACH can access any client;
 * a CLIENT may only access their own. Call this at the top of every page/
 * action that takes a clientId or client slug.
 */
export async function requireClientAccess(clientId: string): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role === "COACH") return user;
  if (user.clientId !== clientId) redirect("/dashboard");
  return user;
}

/**
 * Prisma `where` fragment that scopes any client-scoped model to what the
 * current user is allowed to see: `{}` (no restriction) for a COACH, or
 * `{ clientId: <their own id> }` for a CLIENT. Spread this into `where`
 * clauses, e.g. `prisma.task.findMany({ where: { ...scope, status: "DONE" } })`.
 */
export function clientScopeWhere(user: CurrentUser): { clientId?: string } {
  return user.role === "COACH" ? {} : { clientId: user.clientId ?? "__none__" };
}
