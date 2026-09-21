import { prisma } from "../lib/prisma";
import { computeNeedsAction } from "../lib/needs-action";

// Seeds shared, global CONFIGURATION only (onboarding checklist steps,
// playbook modules/lessons, award tiers) — every block below is guarded by
// a count()===0 check, so it only ever creates these once and never touches
// them again on a later run. Deliberately does NOT create any Client rows
// (or anything scoped to one) — this runs on every `deploy.sh`, and real
// client data must never be touched by it.
async function main() {
  // Onboarding template (global, applies to all clients)
  const onboardingCount = await prisma.onboardingStepTemplate.count();
  if (onboardingCount === 0) {
    const steps = [
      { title: "Meet your business partner", icon: "person" },
      { title: "Program walkthrough", icon: "smart_display" },
      { title: "Join Discord community", icon: "chat" },
      { title: "Complete onboarding form", icon: "description" },
      { title: "Book onboarding call", icon: "event" },
    ];
    for (let i = 0; i < steps.length; i++) {
      await prisma.onboardingStepTemplate.create({ data: { ...steps[i], order: i } });
    }
  }

  // Playbook modules
  const moduleCount = await prisma.module.count();
  if (moduleCount === 0) {
    const startHere = await prisma.module.create({ data: { title: "Start Here", order: 0 } });
    await prisma.lesson.create({
      data: { moduleId: startHere.id, title: "Welcome & how this works", order: 0, content: "Essential context before diving into the rest of the playbooks." },
    });

    const content = await prisma.module.create({ data: { title: "Content & Messaging", order: 1 } });
    await prisma.lesson.create({ data: { moduleId: content.id, title: "Why most coaches fail", order: 0, videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
    await prisma.lesson.create({ data: { moduleId: content.id, title: "Messaging mastery", order: 1, content: "How to position your offer so it sells itself." } });
  }

  // Award tiers
  const tierCount = await prisma.awardTier.count();
  if (tierCount === 0) {
    await prisma.awardTier.create({ data: { name: "$50K", subtitle: "Rising", thresholdRevenue: 50000, order: 0 } });
    await prisma.awardTier.create({ data: { name: "$100K", subtitle: "Elite", thresholdRevenue: 100000, order: 1 } });
    await prisma.awardTier.create({ data: { name: "$200K", subtitle: "Sovereign", thresholdRevenue: 200000, order: 2 } });
  }

  // Recomputes the NeedsActionItem cache off whatever real clients actually
  // exist — safe to run every time, this only ever reads/derives, never
  // injects fake data.
  await computeNeedsAction();
  console.log("Seeded global config (onboarding steps, playbook modules, award tiers) — no client data touched.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
.finally(() => prisma.$disconnect());
