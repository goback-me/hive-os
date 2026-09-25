import { prisma } from "../lib/prisma";
import { computeNeedsAction } from "../lib/needs-action";

// DEMO DATA — fills the DB with a believable agency (clients,
// monthly revenue, ad spend, sessions, onboarding, notes, leads) for demos /
// screen recordings. NOT part of deploy.sh (that runs seed.ts, which never
// touches client data). Re-runnable: it wipes and rebuilds the demo rows for
// the clients below each time.
//
// Jake Of All Tradez is a real sheet-connected client, so his synced leads are
// left alone — only his revenue/campaigns/sessions/notes/onboarding get rebuilt.

// ponytail: explicit opt-in for running on live (demo period only) — remove the flag when real data takes over.
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("demo-seed refuses to run with NODE_ENV=production — it writes fake revenue data. Set ALLOW_DEMO_SEED=1 to override.");
  process.exit(1);
}

const DAY = 86400000;
const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const monthsAgo = (n: number) => new Date(now.getFullYear(), now.getMonth() - n, 1);

type Demo = {
  name: string;
  slug: string;
  programId: string;
  scope: string;
  revenueNow: number; // this month's revenue — history ramps up to it
  months: number; // how many months of revenue history (incl. this one)
  onboardingDone?: number; // default: all steps
  sessionInDays?: number; // upcoming session → "Session in Nd" on the dashboard
  goals: string;
};

const CLIENTS: Demo[] = [
  { name: "Ad Empire", slug: "ad-empire", programId: "dfy", scope: "Paid ads management", revenueNow: 24380, months: 12, sessionInDays: 2, goals: "Scale to $40K/month in booked jobs by end of Q4." },
  { name: "Adam", slug: "adam", programId: "dwy-incubator", scope: "Ads + funnel build", revenueNow: 6420, months: 5, goals: "Get the first 20 booked calls from Meta ads." },
  { name: "Adamo Di Bella", slug: "adamo-di-bella", programId: "dwy-inner", scope: "Paid ads management", revenueNow: 9850, months: 3, onboardingDone: 3, goals: "Consistent 30+ qualified leads per month." },
  { name: "Sarah Chen", slug: "sarah-chen", programId: "dfy", scope: "Ads + CRM setup", revenueNow: 18760, months: 10, sessionInDays: 1, goals: "Double monthly revenue while holding CPL under $35." },
  { name: "Marcus Webb", slug: "marcus-webb", programId: "dwy-incubator", scope: "Paid ads management", revenueNow: 11290, months: 7, goals: "Launch second service area and hit $15K/month." },
  { name: "Priya Patel", slug: "priya-patel", programId: "dwy-inner", scope: "Ads + landing pages", revenueNow: 8940, months: 2, onboardingDone: 2, sessionInDays: 2, goals: "Replace referral dependency with paid acquisition." },
  { name: "Coastal Cleaning Co", slug: "coastal-cleaning-co", programId: "dfy", scope: "Paid ads management", revenueNow: 14620, months: 9, goals: "Fill weekday schedule with recurring commercial contracts." },
  { name: "Summit Roofing", slug: "summit-roofing", programId: "dfy", scope: "Ads + CRM setup", revenueNow: 21350, months: 11, goals: "Book 12 full re-roof jobs per month." },
  { name: "Blue Wave Plumbing", slug: "blue-wave-plumbing", programId: "dwy-inner", scope: "Paid ads management", revenueNow: 12480, months: 8, goals: "Emergency call-outs from ads covering 60% of jobs." },
  { name: "Northside Electrical", slug: "northside-electrical", programId: "dwy-incubator", scope: "Ads + funnel build", revenueNow: 16930, months: 6, sessionInDays: 1, goals: "Move from residential into solar + battery installs." },
  { name: "Prime Solar Solutions", slug: "prime-solar-solutions", programId: "dfy", scope: "Paid ads management", revenueNow: 27640, months: 12, goals: "Hold 4x ROAS while scaling spend to $10K/month." },
  { name: "Elite Landscaping", slug: "elite-landscaping", programId: "dwy-incubator", scope: "Ads + landing pages", revenueNow: 7380, months: 1, onboardingDone: 1, goals: "First full season booked out before summer." },
];

// Jake's history is hand-picked: $78,450 this month, $314,214 lifetime.
const JAKE_REVENUE = [12840, 16920, 21380, 24610, 29870, 33260, 41775, 55109, 78450];

// Deterministic "noise" so re-runs produce identical numbers.
const wobble = (i: number, seed: number) => 1 + Math.sin(i * 12.9898 + seed * 78.233) * 0.09;

function history(d: Demo, seed: number) {
  // Oldest → newest, ramping from ~45% of today's revenue up to exactly revenueNow.
  return Array.from({ length: d.months }, (_, i) => {
    if (i === d.months - 1) return d.revenueNow;
    const ramp = 0.45 + 0.55 * (i / Math.max(d.months - 1, 1));
    return Math.round(d.revenueNow * ramp * wobble(i, seed));
  });
}

const LEAD_NAMES = ["Liam Carter", "Olivia Nguyen", "Noah Williams", "Ava Thompson", "Jack Robinson", "Mia Kelly"];
const LEAD_SOURCES = ["Facebook Ads", "Instagram Ads", "Google Search", "Referral", "Facebook Ads"];
const LEAD_STATUSES = ["WON", "CLIENT_CONTACTED", "CHASE_UP", "NEW_LEAD", "NEW_LEAD"] as const;

async function wipe(clientId: string, keepLeads: boolean) {
  await prisma.needsActionItem.deleteMany({ where: { clientId } });
  if (!keepLeads) {
    await prisma.leadActivity.deleteMany({ where: { lead: { clientId } } });
    await prisma.leadNote.deleteMany({ where: { lead: { clientId } } });
    await prisma.lead.deleteMany({ where: { clientId } });
  }
  await prisma.payment.deleteMany({ where: { clientId } });
  await prisma.revenueMonthly.deleteMany({ where: { clientId } });
  await prisma.session.deleteMany({ where: { clientId } });
  await prisma.adCampaign.deleteMany({ where: { clientId } });
  await prisma.contract.deleteMany({ where: { clientId } });
  await prisma.contactLog.deleteMany({ where: { clientId } });
  await prisma.progressNote.deleteMany({ where: { clientId } });
  await prisma.clientOnboardingStep.deleteMany({ where: { clientId } });
  await prisma.clientAward.deleteMany({ where: { clientId } });
}

async function fill(clientId: string, revenue: number[], opts: { onboardingDone?: number; sessionInDays?: number; campaigns: [string, number][] }) {
  await prisma.revenueMonthly.createMany({
    data: revenue.map((amount, i) => ({ clientId, month: monthsAgo(revenue.length - 1 - i), amount, source: "demo" })),
  });

  await prisma.adCampaign.createMany({
    data: opts.campaigns.map(([name, spend], i) => ({
      clientId,
      name,
      spend,
      status: i === opts.campaigns.length - 1 && opts.campaigns.length > 2 ? "paused" : "active",
      impressions: Math.round(spend * 38),
      profileVisits: Math.round(spend * 0.7),
      engagement: Math.round(spend * 0.18),
      saves: Math.round(spend * 0.03),
    })),
  });

  // One completed session this month keeps "Sessions this month" honest and
  // stops the "No session in 14+ days" warning.
  await prisma.session.create({
    data: { clientId, status: "COMPLETED", scheduledAt: new Date(Math.max(now.getTime() - 3 * DAY, monthStart.getTime() + 3600000)) },
  });
  if (opts.sessionInDays) {
    await prisma.session.create({ data: { clientId, status: "SCHEDULED", scheduledAt: new Date(now.getTime() + opts.sessionInDays * DAY) } });
  }

  const steps = await prisma.onboardingStepTemplate.findMany({ orderBy: { order: "asc" } });
  const done = opts.onboardingDone ?? steps.length;
  await prisma.clientOnboardingStep.createMany({
    data: steps.slice(0, done).map((s) => ({ clientId, templateId: s.id, completedAt: new Date(now.getTime() - 20 * DAY) })),
  });

  await prisma.progressNote.createMany({
    data: [
      { clientId, note: "Creative refresh live — new hooks outperforming control by 22% on CTR.", createdBy: "Hive Team", createdAt: new Date(now.getTime() - 9 * DAY) },
      { clientId, note: "Strategy call done. Budget increase approved; moving winning ad set to CBO.", createdBy: "Hive Team", createdAt: new Date(now.getTime() - 3 * DAY) },
    ],
  });
}

async function main() {
  // Programs the demo clients point at (normally created by the old seed).
  for (const [id, name, durationWeeks] of [["dfy", "DFY", 12], ["dwy-incubator", "DWY (Incubator)", 8], ["dwy-inner", "DWY (Inner Circle)", 24]] as const) {
    await prisma.program.upsert({ where: { id }, update: {}, create: { id, name, durationWeeks } });
  }

  for (const [i, d] of CLIENTS.entries()) {
    const fields = {
      name: d.name,
      email: `hello@${d.slug.replace(/-/g, "")}.com.au`,
      programId: d.programId,
      scope: d.scope,
      goals: d.goals,
      status: (d.onboardingDone !== undefined ? "ONBOARDING" : "ACTIVE") as "ONBOARDING" | "ACTIVE",
      isActive: true,
      archivedAt: null,
      joinedAt: new Date(monthsAgo(d.months - 1).getTime() + 8 * DAY),
    };
    const client = await prisma.client.upsert({ where: { slug: d.slug }, update: fields, create: { slug: d.slug, ...fields } });
    await wipe(client.id, false);

    const revenue = history(d, i + 1);
    const spend = Math.round(d.revenueNow * 0.14);
    await fill(client.id, revenue, {
      onboardingDone: d.onboardingDone,
      sessionInDays: d.sessionInDays,
      campaigns: [["Meta Leads — Always On", Math.round(spend * 0.62)], ["Retargeting — Warm Audience", Math.round(spend * 0.38)]],
    });

    await prisma.lead.createMany({
      data: LEAD_STATUSES.map((status, j) => ({
        clientId: client.id,
        name: LEAD_NAMES[(i + j) % LEAD_NAMES.length],
        source: LEAD_SOURCES[j],
        status,
        value: status === "WON" ? Math.round(d.revenueNow * 0.08) : null,
        createdAt: new Date(now.getTime() - (j + 1) * DAY),
      })),
    });
  }

  // Needs-action variety: a renewal coming up (no red/overdue items in the demo).
  const summit = await prisma.client.findUniqueOrThrow({ where: { slug: "summit-roofing" } });
  await prisma.contract.create({
    data: { clientId: summit.id, startDate: monthsAgo(11), endDate: new Date(now.getTime() + 5 * DAY), monthlyValue: 3500 },
  });

  // ── Jake Of All Tradez — the showcase client ──
  const jakeFields = {
    email: "jake@jakeofalltradez.com.au",
    programId: "dfy",
    scope: "Ads",
    goals: "Hit $100K/month in booked jobs and open a second crew by early next year.",
    status: "ACTIVE" as const,
    isActive: true,
    archivedAt: null,
    joinedAt: new Date(monthsAgo(JAKE_REVENUE.length - 1).getTime() + 11 * DAY),
  };
  const sheetJake = await prisma.client.findFirst({ where: { name: { equals: "Jake Of All Tradez", mode: "insensitive" }, clientSheet: { isNot: null } } });
  const jake = sheetJake
    ? await prisma.client.update({ where: { id: sheetJake.id }, data: jakeFields })
    : await prisma.client.upsert({ where: { slug: "jake-of-all-tradez" }, update: jakeFields, create: { slug: "jake-of-all-tradez", name: "Jake Of All Tradez", ...jakeFields } });
  await wipe(jake.id, true);
  await fill(jake.id, JAKE_REVENUE, {
    onboardingDone: 4,
    sessionInDays: 1,
    campaigns: [["Meta Leads — Bathroom Renos", 6240], ["Meta Leads — Kitchen Renos", 4180], ["Retargeting — Quote Requests", 1440]],
  });

  // Every non-demo client (old test rows, duplicate Jakes) gets archived so
  // the dashboard only shows the demo agency — reversible from Clients → Archived.
  const archived = await prisma.client.updateMany({
    where: { slug: { notIn: [...CLIENTS.map((c) => c.slug), jake.slug] }, archivedAt: null },
    data: { archivedAt: now },
  });

  const items = await computeNeedsAction();
  // Dashboard sorts Needs Action by severity, then newest computedAt — bumping
  // Jake's rows makes him the first card.
  await prisma.needsActionItem.updateMany({ where: { clientId: jake.id }, data: { computedAt: new Date(now.getTime() + 60000) } });
  const lifetime = JAKE_REVENUE.reduce((a, b) => a + b, 0);
  console.log(`Demo data ready: ${CLIENTS.length + 1} active clients, ${items} needs-action items, ${archived.count} other clients archived.`);
  console.log(`Jake: $${JAKE_REVENUE.at(-1)!.toLocaleString()} this month, $${lifetime.toLocaleString()} lifetime, $11,860 ad spend.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
