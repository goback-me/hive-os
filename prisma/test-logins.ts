// Test logins: an admin, an account manager and a client, plus a "Hive Test
// Client" for the client login (with the account manager on it, so My Calls
// has something to show). Safe to re-run.
//
// The account manager and client are ADMIN_EMAIL with +am / +client (same
// inbox) and get TEST_PASSWORD. The admin is ADMIN_EMAIL itself; an existing
// admin keeps their password unless RESET_ADMIN_PASSWORD=1.
//
// On the VPS, after a deploy:
//   docker compose exec -e TEST_PASSWORD='choose-one' app npx tsx prisma/test-logins.ts
//
// Note: the test client has an account manager, so the hourly cron books its
// calls and emails the +am inbox invites and "how did it go?" reminders.
// Archive the client (or clear its account manager) to stop that.

import { createClerkClient } from "@clerk/backend";
import { prisma } from "../lib/prisma";

const password = process.env.TEST_PASSWORD;
const base = process.env.ADMIN_EMAIL;
if (!password || !base || !process.env.CLERK_SECRET_KEY) {
  throw new Error("Set TEST_PASSWORD (and ADMIN_EMAIL / CLERK_SECRET_KEY in .env) first.");
}
const [local, domain] = base.split("@");
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

async function ensure(o: { email: string; name: string; role: "ADMIN" | "COACH" | "CLIENT"; client?: { id: string; slug: string }; setPassword: boolean }) {
  const found = (await clerk.users.getUserList({ emailAddress: [o.email] })).data[0];
  const [firstName, ...rest] = o.name.split(" ");
  const user = found
    ? o.setPassword
      ? await clerk.users.updateUser(found.id, { password, skipPasswordChecks: true })
      : found
    : await clerk.users.createUser({
        emailAddress: [o.email],
        password,
        username: `${o.email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "")}_${Math.floor(Math.random() * 10000)}`,
        firstName,
        lastName: rest.join(" ") || undefined,
        skipPasswordChecks: true,
      });
  await clerk.users.updateUserMetadata(user.id, {
    publicMetadata: { role: o.role, name: o.name, ...(o.client ? { clientId: o.client.id, clientSlug: o.client.slug } : {}) },
  });
  const row = await prisma.user.upsert({
    where: { email: o.email },
    create: { clerkId: user.id, email: o.email, name: o.name, role: o.role, clientId: o.client?.id ?? null },
    update: { clerkId: user.id, role: o.role, clientId: o.client?.id ?? null },
  });
  console.log(`${found ? "updated" : "created"} ${o.role.padEnd(6)} ${o.email}${found && !o.setPassword ? " (password unchanged)" : ""}`);
  return row;
}

async function main() {
  const client = await prisma.client.upsert({
    where: { slug: "hive-test-client" },
    create: { name: "Hive Test Client", slug: "hive-test-client", status: "ACTIVE" },
    update: {},
  });
  await ensure({ email: base!, name: process.env.ADMIN_NAME || "Adeel", role: "ADMIN", setPassword: process.env.RESET_ADMIN_PASSWORD === "1" });
  const am = await ensure({ email: `${local}+am@${domain}`, name: "Test Account Manager", role: "COACH", setPassword: true });
  await ensure({ email: `${local}+client@${domain}`, name: "Test Client", role: "CLIENT", client, setPassword: true });
  await prisma.client.update({ where: { id: client.id }, data: { accountManagerId: am.id } });
  console.log("Done — sign in at /login.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
