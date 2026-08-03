"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function InviteMemberModal({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-primary font-label-md hover:underline">
        + Invite member
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-md modal-overlay" onClick={() => setOpen(false)}>
          <div
            style={{ width: "100%", maxWidth: 448 }}
            className="bg-white rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-lg border-b border-outline-variant flex justify-between items-center">
              <h3 className="font-headline-md text-primary">Invite team member</h3>
              <button onClick={() => setOpen(false)} className="w-10 h-10 rounded-full hover:bg-surface-container flex items-center justify-center text-outline">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form action={action} className="p-lg space-y-lg">
              <div className="space-y-xs">
                <label className="font-label-md text-on-surface-variant ml-xs">Name</label>
                <input name="name" required style={{ width: "100%" }} className="px-md py-sm bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" type="text" placeholder="Full name" />
              </div>
              <div className="space-y-xs">
                <label className="font-label-md text-on-surface-variant ml-xs">Email</label>
                <input name="email" required style={{ width: "100%" }} className="px-md py-sm bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" type="email" placeholder="name@hivesocial.agency" />
              </div>
              <div className="space-y-xs">
                <label className="font-label-md text-on-surface-variant ml-xs">Title</label>
                <input name="title" style={{ width: "100%" }} className="px-md py-sm bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" type="text" placeholder="e.g. Strategist" />
              </div>
              <div className="pt-lg flex items-center justify-end gap-md">
                <button type="button" onClick={() => setOpen(false)} className="px-lg py-md border border-outline-variant text-on-surface-variant rounded-lg font-label-md hover:bg-surface-container">
                  Cancel
                </button>
                <button type="submit" className="px-xl py-md bg-primary text-on-primary rounded-lg font-label-md hover:opacity-90 shadow-md">
                  Add to team
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
