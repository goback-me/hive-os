import { prisma } from "@/lib/prisma";
import { inviteMember } from "@/lib/actions";
import InviteMemberModal from "./InviteMemberModal";

export default async function SettingsPage() {
  const [members, totalClients, clickupConnected, metaConnected] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.client.count(),
    prisma.client.count({ where: { clickupListId: { not: null } } }),
    prisma.client.count({ where: { metaAccessToken: { not: null } } }),
  ]);

  const stripeConnected = Boolean(process.env.STRIPE_SECRET_KEY);

  return (
    <div className="p-margin-desktop max-w-[72rem] mx-auto space-y-xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary">Agency settings</h2>
          <p className="font-body-md text-on-surface-variant">Manage your team and connect third-party tools.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-lg items-start">
        <div className="lg:col-span-2 space-y-lg">
          <section className="custom-card p-lg overflow-hidden">
            <div className="flex items-center justify-between mb-lg">
              <h3 className="font-headline-sm text-primary flex items-center gap-sm">
                <span className="material-symbols-outlined">group</span>
                Team members
              </h3>
              <InviteMemberModal action={inviteMember} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-outline-variant">
                    <th className="py-md font-label-md text-on-surface-variant">Name</th>
                    <th className="py-md font-label-md text-on-surface-variant">Title</th>
                    <th className="py-md font-label-md text-on-surface-variant text-right">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="py-lg flex items-center gap-md">
                        <div className="w-10 h-10 rounded-full bg-primary-container text-white flex items-center justify-center font-bold">
                          {m.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-label-md text-on-surface">{m.name}</div>
                          <div className="text-body-sm text-on-surface-variant">{m.email}</div>
                        </div>
                      </td>
                      <td className="py-lg text-body-md">{m.title ?? "—"}</td>
                      <td className="py-lg text-right">
                        <span className="px-md py-xs bg-secondary-container text-on-secondary-container rounded-full text-label-sm">
                          {m.role}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {members.length === 0 && (
                    <tr><td colSpan={3} className="py-lg text-on-surface-variant">No team members added yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="space-y-lg">
          <section className="custom-card p-lg">
            <h3 className="font-headline-sm text-primary flex items-center gap-sm mb-lg">
              <span className="material-symbols-outlined">hub</span>
              Integrations
            </h3>
            <div className="space-y-md">
              <IntegrationRow
                color="#0668E1"
                icon="ads_click"
                name="Meta Ads"
                desc={`${metaConnected} of ${totalClients} clients connected`}
                connected={metaConnected > 0}
                perClient
              />
              <IntegrationRow color="#635BFF" icon="payments" name="Stripe" desc="Revenue reports" connected={stripeConnected} />
              <IntegrationRow
                color="#7B68EE"
                icon="task_alt"
                name="ClickUp"
                desc={`${clickupConnected} of ${totalClients} clients connected`}
                connected={clickupConnected > 0}
                perClient
              />
            </div>
          </section>

          <div className="custom-card p-lg bg-primary-container text-white relative overflow-hidden">
            <div className="relative z-10">
              <h4 className="font-headline-sm mb-xs">Security check</h4>
              <p className="text-body-sm opacity-90 mb-md">Ensure your account is protected with 2FA and recent login reviews.</p>
            </div>
            <span className="material-symbols-outlined absolute -right-4 -bottom-4 text-9xl opacity-10 pointer-events-none">shield</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntegrationRow({
  color,
  icon,
  name,
  desc,
  connected,
  perClient,
}: {
  color: string;
  icon: string;
  name: string;
  desc: string;
  connected: boolean;
  perClient?: boolean;
}) {
  return (
    <div className="p-md bg-surface-container rounded-xl flex items-center justify-between">
      <div className="flex items-center gap-md">
        <div className="w-12 h-12 rounded-lg flex items-center justify-center text-white" style={{ background: color }}>
          <span className="material-symbols-outlined">{icon}</span>
        </div>
        <div>
          <p className="font-label-md">{name}</p>
          <p className="text-xs text-on-surface-variant">{desc}</p>
        </div>
      </div>
      {connected ? (
        <div className="flex items-center gap-xs">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-label-sm text-green-700">Connected</span>
        </div>
      ) : perClient ? (
        <span className="text-label-sm text-on-surface-variant">Set per client</span>
      ) : (
        <span className="text-label-sm text-on-surface-variant">Not connected</span>
      )}
    </div>
  );
}