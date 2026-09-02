// Removes the "Test Client Co" and all its related rows — run this once
// you're done verifying the deploy and ready to go live with real clients.
//
// Run:  npx tsx scripts/remove-test-client.ts

import { prisma } from "../lib/prisma";
import { computeNeedsAction } from "../lib/needs-action";

const TEST_SLUG = "test-client";

async function main() {
  const client = await prisma.client.findUnique({ where: { slug: TEST_SLUG } });
  if (!client) {
    console.log("No test client found — nothing to remove.");
    return;
  }

  await prisma.$transaction([
    prisma.needsActionItem.deleteMany({ where: { clientId: client.id } }),
    prisma.task.deleteMany({ where: { clientId: client.id } }),
    prisma.lead.deleteMany({ where: { clientId: client.id } }),
    prisma.revenueMonthly.deleteMany({ where: { clientId: client.id } }),
    prisma.adSpendDaily.deleteMany({ where: { clientId: client.id } }),
    prisma.contactLog.deleteMany({ where: { clientId: client.id } }),
    prisma.contract.deleteMany({ where: { clientId: client.id } }),
    prisma.payment.deleteMany({ where: { clientId: client.id } }),
    prisma.client.delete({ where: { id: client.id } }),
  ]);

  await computeNeedsAction();
  console.log("Test client removed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
