import { NextRequest, NextResponse } from "next/server";
import { getClerkAdminClient } from "@/lib/clerk-admin";

// Build redirects from the known public URL, not the incoming request —
// behind Docker's port mapping, the app only ever sees its own internal
// port (3000), not the host-mapped one, so req.url produces a wrong/broken
// redirect. Same fix as app/api/google/callback/route.ts.
const APP_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

// Local-dev convenience only — mints a Clerk sign-in token for ADMIN_EMAIL
// and hands it to the SignIn component via ?__clerk_ticket=, which signs in
// automatically with no form entry. Never usable in production: refuses to
// run unless NODE_ENV isn't "production" AND ADMIN_EMAIL/ADMIN_PASSWORD are
// both set (the same local-only bootstrap vars create-admin.ts uses).
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  const email = process.env.ADMIN_EMAIL;
  const clerk = await getClerkAdminClient();
  const users = await clerk.users.getUserList({ emailAddress: [email] });
  const user = users.data[0];
  if (!user) {
    return NextResponse.json({ error: `No Clerk user found for ${email} — run npm run create-admin first.` }, { status: 404 });
  }

  const signInToken = await clerk.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 60 });
  return NextResponse.redirect(new URL(`/login?__clerk_ticket=${signInToken.token}`, APP_URL));
}
