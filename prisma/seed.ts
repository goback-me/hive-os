import { prisma } from "../lib/prisma";

async function main() {
  const clients = [
    { name: "Revvy", slug: "revvy", claritySlug: "revvy" },
    { name: "Gingin", slug: "gingin" },
    { name: "JOAT", slug: "joat", claritySlug: "joat_funnel" },
    { name: "Loop99", slug: "loop99", claritySlug: "loop99" },
    { name: "Pink Loan", slug: "pink-loan", claritySlug: "pink_loan_1" },
  ];

  for (const c of clients) {
    await prisma.client.upsert({
      where: { slug: c.slug },
      update: {},
      create: c,
    });
  }

  console.log("Seeded clients:", clients.map((c) => c.name).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
