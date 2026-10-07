// Browser only. Side panels open from URL params (?lead=<id>,
// ?update=<callId>&mode=reschedule) so a link can be shared and Back closes
// them. Opening pushes a history entry; closing replaces it. Everything else
// in the URL stays.
export function setUrlParams(values: Record<string, string | null>) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(values)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  const qs = p.toString();
  const opening = Object.values(values).some(Boolean);
  window.history[opening ? "pushState" : "replaceState"](null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
}
export const setUrlParam = (name: string, value: string | null) => setUrlParams({ [name]: value });

// The call update panel (components/CallUpdatePanel.tsx), optionally straight
// into "Rescheduled".
export const openCallPanel = (callId: string, mode?: "reschedule") => setUrlParams({ update: callId, mode: mode ?? null });
