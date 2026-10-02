// One-off: every existing COACH login becomes an ADMIN. Hive HQ's original
// "coach" logins are the agency's admins; the COACH role now means Manager.
// Updates Clerk publicMetadata (what auth reads) and the local User mirror.
// Safe to re-run — only COACH accounts are touched.
//   npx tsx prisma/promote-coaches.ts
import { createClerkClient } from "@clerk/backend";
import { prisma } from "../lib/prisma";

async function main() {
  if (!process.env.CLERK_SECRET_KEY) throw new Error("Set CLERK_SECRET_KEY in your .env first.");
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

  let promoted = 0;
  for (let offset = 0; ; offset += 100) {
    const page = await clerk.users.getUserList({ limit: 100, offset });
    for (const u of page.data) {
      if ((u.publicMetadata as { role?: string })?.role !== "COACH") continue;
      await clerk.users.updateUserMetadata(u.id, { publicMetadata: { ...u.publicMetadata, role: "ADMIN" } });
      await prisma.user.updateMany({ where: { clerkId: u.id }, data: { role: "ADMIN" } });
      const email = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ?? u.id;
      console.log(`Promoted ${email} to ADMIN`);
      promoted++;
    }
    if (page.data.length < 100) break;
  }
  console.log(promoted ? `Done — ${promoted} login(s) promoted. They need to sign out and back in.` : "No COACH logins found — nothing to do.");
}

main().finally(() => prisma.$disconnect());
