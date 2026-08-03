import { prisma } from "@/lib/prisma";
import { createReferral, updateReferralStatus } from "@/lib/actions";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-surface-container-highest text-on-surface-variant",
  APPROVED: "bg-secondary-container text-on-secondary-container",
  REJECTED: "bg-error-container text-on-error-container",
};

export default async function ReferralsPage() {
  const [referrals, totalCount, approvedCount, pendingCount, payoutAgg] = await Promise.all([
    prisma.referral.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.referral.count(),
    prisma.referral.count({ where: { status: "APPROVED" } }),
    prisma.referral.count({ where: { status: "PENDING" } }),
    prisma.referral.aggregate({ _sum: { payoutAmount: true }, where: { status: "APPROVED" } }),
  ]);

  const totalPayouts = Number(payoutAgg._sum.payoutAmount ?? 0);

  return (
    <div className="px-margin-desktop pt-xl pb-2xl">
      <div className="flex justify-between items-end mb-lg">
        <div>
          <h2 className="font-headline-lg text-headline-lg text-primary">Referral network</h2>
          <p className="font-body-md text-on-surface-variant mt-xs">Track your agency's growth through partner submissions and payouts.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter mb-xl">
        <StatCard icon="campaign" label="Total referrals" value={String(totalCount)} />
        <StatCard icon="check_circle" label="Approved deals" value={String(approvedCount)} />
        <StatCard icon="payments" label="Total payouts" value={`$${totalPayouts.toLocaleString()}`} />
        <StatCard icon="hourglass_empty" label="Pending review" value={String(pendingCount)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter items-start">
        <div className="lg:col-span-2 bg-white rounded-xl border border-primary/10 shadow-sm overflow-hidden">
          <div className="px-lg py-md border-b border-outline-variant flex justify-between items-center">
            <h4 className="font-headline-sm text-primary">Recent submissions</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low">
                  <th className="px-lg py-md font-label-md text-on-surface-variant border-b border-outline-variant">Date</th>
                  <th className="px-lg py-md font-label-md text-on-surface-variant border-b border-outline-variant">Referrer</th>
                  <th className="px-lg py-md font-label-md text-on-surface-variant border-b border-outline-variant">Status</th>
                  <th className="px-lg py-md font-label-md text-on-surface-variant border-b border-outline-variant text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {referrals.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-container-lowest transition-colors">
                    <td className="px-lg py-md font-body-sm">{r.createdAt.toLocaleDateString()}</td>
                    <td className="px-lg py-md">
                      <div className="flex items-center gap-md">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                          {r.referrerName.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-label-md text-on-surface">{r.referrerName}</p>
                          <p className="text-[11px] text-on-surface-variant">{r.businessName}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-lg py-md">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                        {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-lg py-md text-right">
                      {r.status === "PENDING" ? (
                        <div className="flex gap-xs justify-end">
                          <form action={updateReferralStatus.bind(null, r.id, "APPROVED")}>
                            <button className="px-2 py-1 text-[11px] font-bold rounded bg-secondary-container text-on-secondary-container hover:opacity-80">
                              Approve
                            </button>
                          </form>
                          <form action={updateReferralStatus.bind(null, r.id, "REJECTED")}>
                            <button className="px-2 py-1 text-[11px] font-bold rounded bg-error-container text-on-error-container hover:opacity-80">
                              Reject
                            </button>
                          </form>
                        </div>
                      ) : (
                        <span className="text-on-surface-variant text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {referrals.length === 0 && (
                  <tr><td colSpan={4} className="px-lg py-lg text-on-surface-variant">No referrals submitted yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-primary/10 shadow-md p-lg">
          <h4 className="font-headline-sm text-primary mb-md">Submit new referral</h4>
          <p className="font-body-sm text-on-surface-variant mb-lg">Fill out the details below to log a new referral.</p>
          <form action={createReferral} className="space-y-lg">
            <div className="space-y-xs">
              <label className="font-label-md text-on-surface block">Referrer name</label>
              <input name="referrerName" required className="w-full px-md py-3 rounded-lg border border-outline-variant bg-surface focus:border-primary focus:ring-primary/20 outline-none transition-all" placeholder="Full name of partner" type="text" />
            </div>
            <div className="space-y-xs">
              <label className="font-label-md text-on-surface block">Business name</label>
              <input name="businessName" required className="w-full px-md py-3 rounded-lg border border-outline-variant bg-surface focus:border-primary focus:ring-primary/20 outline-none transition-all" placeholder="Company or agency name" type="text" />
            </div>
            <div className="space-y-xs">
              <label className="font-label-md text-on-surface block">Email address</label>
              <input name="email" required className="w-full px-md py-3 rounded-lg border border-outline-variant bg-surface focus:border-primary focus:ring-primary/20 outline-none transition-all" placeholder="contact@business.com" type="email" />
            </div>
            <div className="space-y-xs">
              <label className="font-label-md text-on-surface block">Notes</label>
              <textarea name="notes" className="w-full px-md py-3 rounded-lg border border-outline-variant bg-surface focus:border-primary focus:ring-primary/20 outline-none transition-all resize-none" placeholder="Briefly describe the referral opportunity..." rows={4} />
            </div>
            <button type="submit" className="w-full py-4 bg-primary-container text-white font-label-md rounded-lg hover:opacity-90 shadow-lg shadow-primary/20 transition-all">
              Confirm submission
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="bg-white p-lg rounded-xl border border-primary/10 shadow-sm">
      <div className="flex justify-between items-start mb-md">
        <span className="p-2 bg-primary/5 text-primary rounded-lg">
          <span className="material-symbols-outlined">{icon}</span>
        </span>
      </div>
      <p className="font-label-sm text-on-surface-variant uppercase tracking-wider">{label}</p>
      <h3 className="font-headline-md text-primary mt-xs">{value}</h3>
    </div>
  );
}
