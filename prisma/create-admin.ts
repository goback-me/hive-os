// Bootstrap: creates the first ADMIN login, or promotes an existing account
// (e.g. the original COACH login from before the ADMIN role) to ADMIN — safe
// to re-run. After this, use Settings → Users in the app for everyone else.
//
// Usage:
//   ADMIN_EMAIL=you@hivesocial.agency ADMIN_PASSWORD='choose-a-strong-one' ADMIN_NAME="Adeel" \
//     npx tsx prisma/create-admin.ts
//
// Requires CLERK_SECRET_KEY to be set (.env).

import { createClerkClient } from "@clerk/backend";
import { prisma } from "../lib/prisma";

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Coach";

  if (!email || !password) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables before running this script.");
  }
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("Set CLERK_SECRET_KEY in your .env first.");
  }

  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

  // If the Clerk account already exists (e.g. an earlier run created the
  // Clerk login but failed to write the local User row — often because the
  // DB wasn't reachable yet), just link it instead of trying to re-create
  // it, which would fail on Clerk's side with a "duplicate email" error.
  const existingClerkUsers = await clerk.users.getUserList({ emailAddress: [email] });
  let clerkUser = existingClerkUsers.data[0];

  if (clerkUser) {
    console.log(`Found an existing Clerk account for ${email} — linking it instead of creating a new one.`);
  } else {
    const [firstName, ...rest] = name.split(" ");
    const lastName = rest.join(" ") || undefined;
    // Some Clerk instances require a username even when email is the primary
    // identifier. Auto-generate one so this works either way — safe to remove
    // the `username` field below once you've turned Username off in the
    // Clerk dashboard (Configure → Email, Phone, Username).
    const username = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "") + "_" + Math.floor(Math.random() * 10000);

    clerkUser = await clerk.users.createUser({
      emailAddress: [email],
      password,
      username,
      firstName,
      lastName,
      skipPasswordChecks: false,
      // Required by middleware.ts/lib/auth.ts, which read role straight off
      // the Clerk session's publicMetadata rather than hitting Prisma.
      publicMetadata: { role: "ADMIN", name },
    });
  }

  // Set/refresh publicMetadata even for a pre-existing Clerk account — an
  // earlier partial run (or a manually-created account) may not have it,
  // which otherwise sends the coach to /login?error=no-access.
  await clerk.users.updateUserMetadata(clerkUser.id, {
    publicMetadata: { role: "ADMIN", name },
  });

  await prisma.user.upsert({
    where: { email },
    create: { clerkId: clerkUser.id, email, name, role: "ADMIN", clientId: null },
    update: { clerkId: clerkUser.id, role: "ADMIN", clientId: null },
  });

  console.log(`Admin login ready for ${email}. Sign in at /login (sign out and back in if you were already logged in).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());