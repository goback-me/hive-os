import { prisma } from "@/lib/prisma";
import ClientFilter from "@/components/ClientFilter";
import GoogleAccountCard from "@/components/GoogleAccountCard";
import LeadsSheetPanel from "@/components/LeadsSheetPanel";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; error?: string }>;
}) {
  const params = await searchParams;

  const [clients, googleConnection] = await Promise.all([
    prisma.client.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    }),
    prisma.googleAccountConnection.findFirst({ orderBy: { connectedAt: "desc" } }),
  ]);

  if (clients.length === 0) {
    return (
      <div className="p-margin-desktop">
        <h2 className="font-headline-lg text-headline-lg text-primary">Leads</h2>
        <p className="text-on-surface-variant mt-md">Add a client first, then assign their lead sheet here.</p>
      </div>
    );
  }

  const activeSlug = params.client ?? clients[0].slug;
  const activeClient = clients.find((c) => c.slug === activeSlug) ?? clients[0];

  const sheet = await prisma.clientSheet.findUnique({ where: { clientId: activeClient.id } });

  return (
    <div className="p-margin-desktop">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-lg mb-xl">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary">Leads</h2>
          <p className="font-body-md text-on-surface-variant mt-xs">
            Live lead data pulled from each client's assigned Google Sheet.
          </p>
        </div>
        <ClientFilter clients={clients} activeSlug={activeClient.slug} />
      </div>

      {params.error && (
        <div className="mb-lg p-md bg-red-50 border border-red-200 rounded-lg text-body-sm text-red-700">
          Couldn't connect: {params.error}
        </div>
      )}

      <GoogleAccountCard connected={Boolean(googleConnection)} googleEmail={googleConnection?.googleEmail ?? null} />

      <LeadsSheetPanel
        clientId={activeClient.id}
        googleConnected={Boolean(googleConnection)}
        spreadsheetId={sheet?.spreadsheetId ?? null}
        spreadsheetName={sheet?.spreadsheetName ?? null}
        sheetName={sheet?.sheetName ?? null}
      />
    </div>
  );
}