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
      {pending ? "Creating…" : busy ? "Opening…" : "Create client"}
    </button>
  );
}

export default function AddClientModal({
  action,
}: {
  action: (prev: CreateClientState, formData: FormData) => Promise<CreateClientState>;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [state, formAction] = useFormState(action, null);
  // Set once the client is created — the modal stays up with a spinner while
  // the (slow) client page loads, instead of looking like nothing happened.
  const [navigating, setNavigating] = useState(false);
  const router = useRouter();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (state && "slug" in state) {
      setNavigating(true);
      router.push(`/clients/${state.slug}`);
    }
  }, [state, router]);

  const inputStyle = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" } as const;
  const close = () => {
    if (!navigating) setOpen(false);
  };

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
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={close}
        >
          <div
            className="card rounded-2xl overflow-hidden"
            style={{ width: "100%", maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 flex justify-between items-center" style={{ borderBottom: "1px solid var(--border)" }}>
              <h3 className="font-heading font-bold text-lg" style={{ color: "var(--text-primary)" }}>Add Client</h3>
              <button onClick={close} style={{ color: "var(--text-muted)" }}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form action={formAction} className="p-5 space-y-4">
              {state && "error" in state && (
                <div className="px-3 py-2.5 rounded-lg text-sm" style={{ background: "var(--danger-tint)", color: "var(--danger)" }}>
                  {state.error}
                </div>
              )}
              <fieldset disabled={navigating} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Client name *</label>
                  <input name="name" required style={inputStyle} className="px-3 py-2 rounded-lg outline-none" placeholder="e.g. Sarah Chen" />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Description</label>
                  <input name="description" style={inputStyle} className="px-3 py-2 rounded-lg outline-none" placeholder="e.g. Tattoo artist marketing consulting" />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Scope</label>
                  <input name="scope" style={inputStyle} className="px-3 py-2 rounded-lg outline-none" placeholder="e.g. Paid ads management" />
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Google Drive link (optional)</label>
                  <input name="driveLink" style={inputStyle} className="px-3 py-2 rounded-lg outline-none" placeholder="https://drive.google.com/drive/folders/..." />
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>Sets up their Gameplan folder now — you can always add or change it later.</p>
                </div>
                <div>
                  <label className="text-xs font-semibold block mb-1" style={{ color: "var(--text-secondary)" }}>Status</label>
                  <select name="status" defaultValue="ONBOARDING" style={inputStyle} className="px-3 py-2 rounded-lg outline-none">
                    <option value="ONBOARDING">Onboarding</option>
                    <option value="ACTIVE">Active</option>
                    <option value="CHURNED">Not Active</option>
                  </select>
                </div>
              </fieldset>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={navigating}
                  className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
                >
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
