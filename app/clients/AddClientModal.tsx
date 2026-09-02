"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function AddClientModal({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-primary text-on-primary px-lg py-md rounded-lg font-label-md flex items-center gap-sm shadow-sm hover:opacity-90 transition-all"
      >
        <span className="material-symbols-outlined">add</span>
        Add client
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-md modal-overlay" onClick={() => setOpen(false)}>
          <div
            style={{ width: "100%", maxWidth: 576 }}
            className="bg-white rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-lg border-b border-outline-variant flex justify-between items-center">
              <div>
                <h3 className="font-headline-md text-primary">Add new client</h3>
                <p className="text-label-sm text-on-surface-variant">Initialize a new account in the agency system.</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-10 h-10 rounded-full hover:bg-surface-container flex items-center justify-center text-outline transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form action={action} className="p-lg space-y-lg">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-lg">
                <div className="space-y-xs">
                  <label className="font-label-md text-on-surface-variant ml-xs">Client name</label>
                  <input
                    name="name"
                    required
                    style={{ width: "100%" }}
                    className="px-md py-sm bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    placeholder="e.g. Acme Corp"
                    type="text"
                  />
                </div>
                <div className="space-y-xs">
                  <label className="font-label-md text-on-surface-variant ml-xs">Website</label>
                  <input
                    name="website"
                    style={{ width: "100%" }}
                    className="px-md py-sm bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    placeholder="https://acme.com"
                    type="url"
                  />
                </div>
              </div>
              <div className="space-y-xs">
                <label className="font-label-md text-on-surface-variant ml-xs">Main contact</label>
                <div style={{ position: "relative" }}>
                  <span className="material-symbols-outlined text-outline" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>person</span>
                  <input
                    name="contact"
                    style={{ width: "100%", paddingLeft: 40 }}
                    className="pr-md py-sm bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    placeholder="Full name of primary stakeholder"
                    type="text"
                  />
                </div>
              </div>
              <div className="space-y-xs">
                <label className="font-label-md text-on-surface-variant ml-xs">Monthly budget</label>
                <div style={{ position: "relative" }}>
                  <span className="material-symbols-outlined text-outline" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>payments</span>
                  <input
                    name="budget"
                    style={{ width: "100%", paddingLeft: 40 }}
                    className="pr-md py-sm bg-white border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                    placeholder="Enter amount in USD"
                    type="number"
                  />
                </div>
              </div>

              <div className="pt-lg flex items-center justify-end gap-md">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-lg py-md border border-outline-variant text-on-surface-variant rounded-lg font-label-md hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-xl py-md bg-primary text-on-primary rounded-lg font-label-md hover:opacity-90 transition-all shadow-md"
                >
                  Create client profile
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
