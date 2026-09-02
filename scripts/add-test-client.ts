// Adds one fully-populated test client so you can see the entire UI working
// end to end: overdue payment, expired contract, upcoming renewal, no-contact
// flag, ad spend, revenue, leads, and a few Kanban tasks.
//
// Run:  npm run test:client
// Safe to run multiple times — it upserts on slug and clears/rebuilds the
// test client's data each time so you always get a clean example.

import { prisma } from "../lib/prisma";
import { computeNeedsAction } from "../lib/needs-action";

const TEST_SLUG = "test-client";

async function main() {
  const existing = await prisma.client.findUnique({ where: { slug: TEST_SLUG } });
  if (existing) {
    await prisma.$transaction([
      prisma.needsActionItem.deleteMany({ where: { clientId: existing.id } }),
      prisma.task.deleteMany({ where: { clientId: existing.id } }),
      prisma.lead.deleteMany({ where: { clientId: existing.id } }),
      prisma.revenueMonthly.deleteMany({ where: { clientId: existing.id } }),
      prisma.adSpendDaily.deleteMany({ where: { clientId: existing.id } }),
      prisma.contactLog.deleteMany({ where: { clientId: existing.id } }),
      prisma.contract.deleteMany({ where: { clientId: existing.id } }),
      prisma.payment.deleteMany({ where: { clientId: existing.id } }),
    ]);
  }

  const client = await prisma.client.upsert({
    where: { slug: TEST_SLUG },
    update: { isActive: true },
    create: {
      name: "Test Client Co",
      slug: TEST_SLUG,
      isActive: true,
      metaAdAccountId: "act_TESTACCOUNT123",
      clickupListId: "test-clickup-list",
      claritySlug: "test_client_funnel",
    },
  });

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 86400000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // 1. An overdue payment — triggers the red "overdue" Needs Action card
  await prisma.payment.create({
    data: {
      clientId: client.id,
      type: "DEPOSIT",
      label: "Deposit",
      amountDue: 4000,
      dueDate: daysAgo(25),
      status: "PENDING",
    },
  });

  // 2. A second payment, not yet due — should NOT trigger a card
  await prisma.payment.create({
    data: {
      clientId: client.id,
      type: "SECOND_PAYMENT",
      label: "Second payment",
      amountDue: 4000,
      dueDate: daysFromNow(20),
      status: "PENDING",
    },
  });

  // 3. An expired contract — triggers the red "renew" card
  await prisma.contract.create({
    data: {
      clientId: client.id,
      startDate: daysAgo(400),
      endDate: daysAgo(4),
      status: "EXPIRED",
      monthlyValue: 3500,
    },
  });

  // 4. A second, active contract with upcoming renewal — triggers the green card
  await prisma.contract.create({
    data: {
      clientId: client.id,
      startDate: daysAgo(300),
      endDate: daysFromNow(9),
      status: "ACTIVE",
      monthlyValue: 2200,
    },
  });

  // 5. Last contact 14 days ago — triggers the "no call" card
  await prisma.contactLog.create({
    data: {
      clientId: client.id,
      contactedAt: daysAgo(14),
      method: "call",
      notes: "Monthly check-in call",
      loggedBy: "Adeel",
    },
  });

  // 6. Ad spend for the current month (spread across several days)
  for (let i = 0; i < 10; i++) {
    await prisma.adSpendDaily.create({
      data: {
        clientId: client.id,
        date: new Date(monthStart.getTime() + i * 86400000),
        spend: 45 + Math.round(Math.random() * 30),
        impressions: 1200 + Math.round(Math.random() * 800),
        clicks: 30 + Math.round(Math.random() * 20),
        source: "meta",
      },
    });
  }

  // 7. Revenue for the current month
  await prisma.revenueMonthly.create({
    data: {
      clientId: client.id,
      month: monthStart,
      amount: 8400,
      source: "manual",
    },
  });

  // 8. A handful of leads
  const sources = ["facebook", "instagram", "google"];
  for (let i = 0; i < 6; i++) {
    await prisma.lead.create({
      data: {
        clientId: client.id,
        source: sources[i % sources.length],
        campaign: "test_campaign_summer",
        status: i < 2 ? "won" : i < 4 ? "contacted" : "new",
        value: i < 2 ? 450 : null,
      },
    });
  }

  // 9. A few Kanban tasks in both columns
  await prisma.task.createMany({
    data: [
      { clientId: client.id, title: "Write 3 UGC hooks for winter promo", status: "TODO" },
      { clientId: client.id, title: "Review last week's ad creative", status: "TODO" },
      { clientId: client.id, title: "Set up landing page A/B test", status: "DONE" },
    ],
  });

  // Sample referral (safe to run repeatedly — only creates one if none exist)
  const referralCount = await prisma.referral.count();
  if (referralCount === 0) {
    await prisma.referral.create({
      data: {
        referrerName: "John Doe",
        businessName: "Doe Marketing Ltd.",
        email: "john@doemarketing.example",
        notes: "Met at a local business meetup, interested in social ad management.",
        status: "PENDING",
      },
    });
  }

  // Sample team member
  const memberCount = await prisma.user.count();
  if (memberCount === 0) {
    await prisma.user.create({
      data: {
        name: "Adeel",
        email: "adeel@hivesocial.agency",
        title: "Founder",
        role: "ADMIN",
        passwordHash: "PENDING_INVITE",
      },
    });
  }

  // Rebuild the Needs Action cache so the new client shows up immediately
  const count = await computeNeedsAction();

  console.log(`Test client ready: /clients/${client.slug}`);
  console.log(`Needs Action items recomputed across all clients: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());