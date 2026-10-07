"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import type { CreateClientState } from "@/lib/actions";

// Disabled + spinner while the action runs — a second click can't submit
// the form again. `busy` keeps it locked after success too, until the new
// client's page has actually opened.
function SubmitButton({ busy }: { busy: boolean }) {
  const { pending } = useFormStatus();
  const working = pending || busy;
  return (
    <button
      type="submit"
      disabled={working}
      aria-busy={working}
      className="px-4 py-2 rounded-lg text-sm font-bold btn-cta flex items-center gap-2 disabled:opacity-70 disabled:cursor-wait"
      style={{ background: "var(--secondary)", color: "#fff" }}
    >
      {working && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
      {pending ? "Setting up…" : busy ? "Opening…" : "Create client"}
    </button>
  );
}

type Option = { id: string; name: string };
type ClickUp = { lists: Option[]; targets: Option[]; members: Option[] } | { error: string } | null;

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());

// Everything a new client needs for the automations, in one go: who they
// are, how we reach them (email, Slack), where their ClickUp tasks go and
// who gets them, and who runs their weekly call. Only the name is required —
// anything left blank just switches that automation off for this client
// (e.g. no email = reminder emails paused) until it's added on their page.
export default function AddClientModal({
  action,
  team,
}: {
  action: (prev: CreateClientState, formData: FormData) => Promise<CreateClientState>;
  team: Option[]; // who can run the weekly call
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [state, formAction] = useFormState(action, null);
  const [navigating, setNavigating] = useState(false);
  const [clickup, setClickup] = useState<ClickUp>(null);
  const [clickupMode, setClickupMode] = useState<"create" | "existing" | "none">("create");
  const router = useRouter();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (state && "slug" in state) {
      setNavigating(true);
      router.push(`/clients/${state.slug}`);
    }
  }, [state, router]);

  // ClickUp's options load when the form opens.
  useEffect(() => {
    if (!open || clickup) return;
    fetch("/api/clickup/lists")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setClickup({ error: d.error });
        setClickup({ lists: d.lists ?? [], targets: d.spaces ?? [], members: d.members ?? [] });
        if (!d.spaces?.length) setClickupMode(d.lists?.length ? "existing" : "none");
      })
      .catch(() => setClickup({ error: "Couldn't reach ClickUp" }));
  }, [open, clickup]);

  const inputStyle = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" } as const;
  const close = () => {
    if (!navigating) setOpen(false);
  };
  const ready = clickup && !("error" in clickup) ? clickup : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm btn-cta"
        style={{ background: "var(--secondary)", color: "#fff" }}
      >
        <span className="material-symbols-outlined text-[18px]">add</span>
        Add Client
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={close}>
          <div className="card rounded-2xl overflow-hidden flex flex-col" style={{ width: "100%", maxWidth: 640, maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="p-5 flex justify-between items-center shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
              <div>
                <h3 className="font-heading font-bold text-lg" style={{ color: "var(--text-primary)" }}>Add Client</h3>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Set everything up now so the automations work from day one. Only the name is required.</p>
              </div>
              <button onClick={close} style={{ color: "var(--text-muted)" }}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form action={formAction} className="p-5 space-y-5 overflow-y-auto">
              {state && "error" in state && (
                <div className="px-3 py-2.5 rounded-lg text-sm" style={{ background: "var(--danger-tint)", color: "var(--danger)" }}>{state.error}</div>
              )}
              <fieldset disabled={navigating} className="space-y-5">
                <Section title="The client">
                  <Field label="Client name *">
                    <input name="name" required style={inputStyle} className="px-3 py-2 rounded-lg outline-none" placeholder="e.g. Jake Of All Tradez" />
                  </Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Type" hint="Trade = “Onsite quote” / “Job won”">
                      <select name="clientType" defaultValue="TRADE" style={inputStyle} className="px-3 py-2 rounded-lg outline-none">
                        <option value="TRADE">Trade</option>
                        <option value="SERVICE">Service</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </Field>
                    <Field label="Start date" hint="Reports count from here">
                      <input name="startDate" type="date" defaultValue={today()} style={inputStyle} className="px-3 py-2 rounded-lg outline-none" />
                    </Field>
                    <Field label="Status">
                      <select name="status" defaultValue="ONBOARDING" style={inputStyle} className="px-3 py-2 rounded-lg outline-none">
                        <option value="ONBOARDING">Onboarding</option>
                        <option value="ACTIVE">Active</option>
                        <option value="CHURNED">Not Active</option>
                      </select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Description">
                      <input name="description" style={inputStyle} className="px-3 py-2 rounded-lg outline-none" placeholder="e.g. Landscaping, Perth" />
                    </Field>
                    <Field label="Scope">
                      <input name="scope" style={inputStyle} className="px-3 py-2 rounded-lg outline-none" placeholder="e.g. Paid ads + call centre" />
                    </Field>
                  </div>
                </Section>

                <Section title="How we reach them">
                  <Field label="Client email" hint="For “leads waiting on your update” emails. Leave blank and those emails are paused for this client until it's added.">
                    <input name="email" type="email" style={inputStyle} className="px-3 py-2 rounded-lg outline-none" placeholder="owner@client.com.au" />
                  </Field>
                  <Field label="Slack channel ID" hint="Their channel's ID (channel name → About → bottom). Posts sales, live transfers, weekly updates and the 8am digest. Blank = no Slack posts.">
                    <input name="slackChannelId" style={inputStyle} className="px-3 py-2 rounded-lg outline-none" placeholder="C0123ABCD" />
                  </Field>
                  <Field label="Google Drive folder" hint="Shows as a “Google Drive” button on their page.">
                    <input name="driveLink" style={inputStyle} className="px-3 py-2 rounded-lg outline-none" placeholder="https://drive.google.com/drive/folders/..." />
                  </Field>
                </Section>

                <Section title="ClickUp tasks">
                  {!clickup ? (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>Loading ClickUp…</p>
                  ) : "error" in clickup ? (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>ClickUp isn&apos;t available ({clickup.error}). The client is created without it — set it up on their page later.</p>
                  ) : (
                    <>
                      <input type="hidden" name="clickupMode" value={clickupMode} />
                      <div className="flex gap-2 flex-wrap">
                        {ready!.targets.length > 0 && <Choice on={clickupMode === "create"} onClick={() => setClickupMode("create")}>Create their lists</Choice>}
                        {ready!.lists.length > 0 && <Choice on={clickupMode === "existing"} onClick={() => setClickupMode("existing")}>Use an existing list</Choice>}
                        <Choice on={clickupMode === "none"} onClick={() => setClickupMode("none")}>No ClickUp</Choice>
                      </div>
                      {clickupMode === "create" && (
                        <Field label="Create in" hint="Makes Account / Client / Other lists for this client — HQ's tasks go to Account.">
                          <select name="clickupTarget" style={inputStyle} className="px-3 py-2 rounded-lg outline-none">
                            {ready!.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </Field>
                      )}
                      {clickupMode === "existing" && (
                        <Field label="List">
                          <select name="clickupListId" style={inputStyle} className="px-3 py-2 rounded-lg outline-none">
                            {ready!.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                        </Field>
                      )}
                      {clickupMode !== "none" && ready!.members.length > 0 && (
                        <Field label="Assign HQ's tasks to">
                          <div className="flex flex-wrap gap-1.5">
                            {ready!.members.map((m) => (
                              <label key={m.id} className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs cursor-pointer" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                                <input type="checkbox" name="clickupAssigneeIds" value={m.id} className="accent-[var(--primary)]" />
                                {m.name}
                              </label>
                            ))}
                          </div>
                        </Field>
                      )}
                    </>
                  )}
                </Section>

                <Section title="Account management">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Account manager" hint="Their calls are booked from the slot below; they get an invite and a “how did it go?” email the day after.">
                      <select name="accountManagerId" defaultValue="" style={inputStyle} className="px-3 py-2 rounded-lg outline-none">
                        <option value="">Nobody yet</option>
                        {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Regular call">
                      <div className="flex gap-1.5">
                        <select name="callFrequency" defaultValue="WEEKLY" style={inputStyle} className="px-2 py-2 rounded-lg outline-none" aria-label="How often">
                          <option value="WEEKLY">Every</option>
                          <option value="FORTNIGHTLY">Every 2nd</option>
                        </select>
                        <select name="callDay" defaultValue="FRIDAY" style={inputStyle} className="px-2 py-2 rounded-lg outline-none" aria-label="Call day">
                          {DAYS.map((d) => <option key={d} value={d}>{d.charAt(0) + d.slice(1, 3).toLowerCase()}</option>)}
                        </select>
                        <input type="time" name="callTime" defaultValue="10:00" step={900} style={inputStyle} className="px-2 py-2 rounded-lg outline-none" aria-label="Call time" />
                      </div>
                    </Field>
                  </div>
                </Section>

                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  After creating: connect their leads Google Sheet on the Leads page — their page shows a setup checklist of anything still missing.
                </p>
              </fieldset>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={close} disabled={navigating} className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  Cancel
                </button>
                <SubmitButton busy={navigating} />
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-bold tracking-wide" style={{ color: "var(--text-muted)" }}>{title.toUpperCase()}</p>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>{label}</label>
      {children}
      {hint && <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={on ? { background: "var(--primary)", color: "#fff" } : { border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
      {children}
    </button>
  );
}
