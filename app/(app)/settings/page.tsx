import { prisma } from "@/lib/prisma";
import { saveIntegrationSettings, createOnboardingStepTemplate, createModule, createClient } from "@/lib/actions";
import { requireCoach } from "@/lib/auth";
import UsersPanel from "./UsersPanel";
import AddLessonForm from "@/components/AddLessonForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireCoach();

  const [integration, onboardingSteps, awardTiers, modules, users, clients] = await Promise.all([
    prisma.integrationSettings.findUnique({ where: { id: "singleton" } }),
    prisma.onboardingStepTemplate.findMany({ orderBy: { order: "asc" } }),
    prisma.awardTier.findMany({ orderBy: { order: "asc" } }),
    prisma.module.findMany({ orderBy: { order: "asc" }, include: { lessons: true } }),
    prisma.user.findMany({ orderBy: { createdAt: "asc" }, include: { client: { select: { name: true } } } }),
    prisma.client.findMany({ where: { archivedAt: null, status: { not: "CHURNED" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const userRows = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    clientName: u.client?.name ?? null,
  }));

  return (
    <div className="p-10 max-w-[1000px] mx-auto space-y-8">
      <div>
        <h1 className="font-heading text-3xl font-bold" style={{ color: "var(--text-primary)" }}>Settings</h1>
        <p style={{ color: "var(--text-secondary)" }}>Connections and templates used across every client.</p>
      </div>

      <UsersPanel users={userRows} clients={clients} onCreateClient={createClient} />

      <section className="card rounded-2xl p-6">
        <h3 className="font-heading font-bold text-lg mb-1" style={{ color: "var(--text-primary)" }}>Integrations</h3>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          Connect ClickUp to sync tasks automatically, or keep using manual task entry — both work side by side.
          The agency-wide Google account used for client lead sheets, and each client's own Meta Ads connection,
          are managed on the <a href="/leads" style={{ color: "var(--primary)", fontWeight: 600 }}>Leads</a> page
          and each client's Ads tab.
        </p>
        <form action={saveIntegrationSettings} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="ClickUp API key" name="clickupApiKey" defaultValue={integration?.clickupApiKey ?? ""} placeholder="pk_..." />
            <Field label="ClickUp Team ID" name="clickupTeamId" defaultValue={integration?.clickupTeamId ?? ""} placeholder="123456" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>CRM</label>
              <select
                name="crmType"
                defaultValue={integration?.crmType ?? ""}
                style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
                className="px-3 py-2 rounded-lg outline-none text-sm"
              >
                <option value="">Not connected</option>
                <option value="ghl">GoHighLevel</option>
                <option value="spreadsheet">Google Sheet</option>
              </select>
            </div>
            <Field label="API key or sheet URL" name="crmApiKeyOrUrl" defaultValue={integration?.crmApiKeyOrUrl ?? ""} placeholder="https://docs.google.com/..." />
          </div>
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-bold btn-cta" style={{ background: "var(--secondary)", color: "#fff" }}>
            Save integrations
          </button>
        </form>
        <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
          Note: saving these keys stores them for future syncing — the actual ClickUp/GHL sync jobs aren't wired up yet, this just gets the connection ready.
        </p>
      </section>

      <section className="card rounded-2xl p-6">
        <h3 className="font-heading font-bold text-lg mb-1" style={{ color: "var(--text-primary)" }}>Onboarding template</h3>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          Every client gets this same checklist. Add steps once, applies to everyone.
        </p>
        <div className="space-y-2 mb-4">
          {onboardingSteps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg p-3" style={{ background: "var(--surface)" }}>
              <span className="text-xs font-bold w-5" style={{ color: "var(--text-muted)" }}>{i + 1}</span>
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{s.title}</p>
                {s.description && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{s.description}</p>}
              </div>
            </div>
          ))}
          {onboardingSteps.length === 0 && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No steps yet.</p>}
        </div>
        <form action={createOnboardingStepTemplate} className="flex gap-2">
          <input name="title" required placeholder="Step title" style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} className="px-3 py-2 rounded-lg outline-none text-sm" />
          <input name="description" placeholder="Description (optional)" style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} className="px-3 py-2 rounded-lg outline-none text-sm" />
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-bold" style={{ background: "var(--primary)", color: "#fff" }}>Add step</button>
        </form>
      </section>

      <section className="card rounded-2xl p-6">
        <h3 className="font-heading font-bold text-lg mb-1" style={{ color: "var(--text-primary)" }}>Playbooks library</h3>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          Shared across every client. Add a module, then add lessons to it.
        </p>

        <div className="space-y-2 mb-4">
          {modules.map((mod, i) => (
            <div key={mod.id} className="rounded-lg p-3" style={{ background: "var(--surface)" }}>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{i + 1}. {mod.title}</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {mod.lessons.length} lesson{mod.lessons.length !== 1 ? "s" : ""}
              </p>
            </div>
          ))}
          {modules.length === 0 && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No modules yet.</p>}
        </div>

        <form action={createModule} className="flex gap-2 mb-5">
          <input name="title" required placeholder="New module title, e.g. IG & YT Content" style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }} className="px-3 py-2 rounded-lg outline-none text-sm" />
          <button type="submit" className="px-4 py-2 rounded-lg text-sm font-bold" style={{ background: "var(--primary)", color: "#fff" }}>Add module</button>
        </form>

        <div style={{ borderTop: "1px solid var(--border)" }} className="pt-4">
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>Add a lesson to a module</p>
          <AddLessonForm modules={modules.map((m) => ({ id: m.id, title: m.title }))} />
        </div>
      </section>

      <section className="card rounded-2xl p-6">
        <h3 className="font-heading font-bold text-lg mb-1" style={{ color: "var(--text-primary)" }}>Award tiers</h3>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          Auto-granted when a client crosses a lifetime revenue milestone.
        </p>
        <div className="space-y-2">
          {awardTiers.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg p-3" style={{ background: "var(--surface)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{t.name}</span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {t.thresholdRevenue ? `$${Number(t.thresholdRevenue).toLocaleString()} lifetime` : "Course completion"}
              </span>
            </div>
          ))}
          {awardTiers.length === 0 && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No tiers yet — add via seed script or a future admin form.</p>}
        </div>
      </section>
    </div>
  );
}

function Field({ label, name, defaultValue, placeholder }: { label: string; name: string; defaultValue: string; placeholder: string }) {
  return (
    <div>
      <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>{label}</label>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        className="px-3 py-2 rounded-lg outline-none text-sm"
      />
    </div>
  );
}