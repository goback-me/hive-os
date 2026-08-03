import { prisma } from "@/lib/prisma";
import SearchOverlay from "./SearchOverlay";
import NotificationsBell from "./NotificationsBell";

export default async function AppHeader() {
  const [items, clients] = await Promise.all([
    prisma.needsActionItem.findMany({
      orderBy: [{ severity: "asc" }, { computedAt: "desc" }],
      take: 6,
      include: { client: { select: { slug: true } } },
    }),
    prisma.client.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);

  const notifications = items.map((i: (typeof items)[number]) => ({
    id: i.id,
    title: i.title,
    description: i.description,
    severity: i.severity,
    clientSlug: i.client.slug,
    computedAt: i.computedAt.toISOString(),
  }));

  return (
    <header
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", height: 64 }}
      className="px-margin-desktop sticky top-0 z-40 bg-surface/80 backdrop-blur-md border-b border-outline-variant"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24, flex: 1, minWidth: 0 }}>
        <SearchOverlay clients={clients} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <NotificationsBell notifications={notifications} />
        <button className="p-2 rounded-full hover:bg-surface-container transition-colors text-on-surface-variant">
          <span className="material-symbols-outlined">help</span>
        </button>
        <div className="h-8 w-8 rounded-full bg-primary-container/10 border border-outline-variant ml-sm flex items-center justify-center text-[12px] font-bold text-primary">
          A
        </div>
      </div>
    </header>
  );
}