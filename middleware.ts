import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Routes that don't require a signed-in session at all.
const isPublicRoute = createRouteMatcher(["/login(.*)", "/refer(.*)", "/api/webhooks/clerk"]);

// Pages that only a COACH account may reach — everything else falls
// through to the shared/client-scoped handling below. (Adapted from Hive
// OS's isAdminOnlyRoute, extended with the original coaching app's own agency-wide pages.)
const isCoachOnlyRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/clients",
  "/settings(.*)",
  "/referrals(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return NextResponse.next();

  const { userId, sessionClaims, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: req.url });

  // publicMetadata is set the moment an account is created — see
  // lib/actions.ts createUser — and mirrored by the Clerk webhook,
  // app/api/webhooks/clerk/route.ts.
  const metadata = (sessionClaims?.publicMetadata ?? {}) as {
    role?: "COACH" | "CLIENT";
    clientId?: string; // Client.id (cuid)
    clientSlug?: string; // Client.slug — used by /clients/[slug]
  };

  // Account exists in Clerk but hasn't been assigned a role/client yet
  // (shouldn't normally happen — accounts are only created by a coach
  // with metadata already set — but fail safe rather than 500).
  if (!metadata.role) {
    return NextResponse.redirect(new URL("/login?error=no-access", req.url));
  }

  const { pathname } = req.nextUrl;

  if (metadata.role === "CLIENT") {
    const home = metadata.clientSlug ? `/clients/${metadata.clientSlug}` : "/login?error=no-client";

    if (isCoachOnlyRoute(req)) {
      return NextResponse.redirect(new URL(home, req.url));
    }

    // Block a client account from viewing another client's detail page.
    const clientDetailMatch = pathname.match(/^\/clients\/([^/]+)/);
    if (clientDetailMatch && clientDetailMatch[1] !== metadata.clientSlug) {
      return NextResponse.redirect(new URL(home, req.url));
    }

    // /leads takes a client-scoping query param (see app/(app)/leads/page.tsx)
    // — force it to this account's own client so they can't page through
    // others' data by editing the URL.
    if (pathname === "/leads" && metadata.clientSlug) {
      const url = req.nextUrl.clone();
      if (url.searchParams.get("client") !== metadata.clientSlug) {
        url.searchParams.set("client", metadata.clientSlug);
        return NextResponse.redirect(url);
      }
    }

    if (pathname === "/" || pathname === "/dashboard") {
      return NextResponse.redirect(new URL(home, req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
