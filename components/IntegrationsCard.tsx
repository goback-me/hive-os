"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Events = { sales: boolean; liveTransfers: boolean; weeklyUpdates: boolean; dailyDigest: boolean };
const EVENT_LABELS: Record<keyof Events, string> = {
  sales: "New sale",
  liveTransfers: "New live transfer",
  weeklyUpdates: "Weekly update published",
  dailyDigest: "Daily 8am digest",
};
type Result = { ok: true } | { error: string };

// Coach only: this client's Slack channel (+ which posts go there) and
// ClickUp list, a Slack test, and a "Create ClickUp task" form.
export default function IntegrationsCard({
  clientId,
  initial,
  onSave,
  onTest,
  onCreateTask,
}: {
  clientId: string;
  initial: { slackChannelId: string; slackEvents: Events; clickupListId: string };
  onSave: (clientId: string, input: { slackChannelId: string; slackEvents: Events; clickupListId: string }) => Promise<void>;
  onTest: (clientId: string) => Promise<Result>;
  onCreateTask: (clientId: string, input: { title: string; description: string; due: string }) => Promise<Result>;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [lists, setLists] = useState<{ id: string; name: string }[] | null>(null);
  const [listsError, setListsError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [task, setTask] = useState<{ title: string; description: string; due: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const input = { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)" };
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => {
    fetch("/api/clickup/lists")
      .then((r) => r.json())
      .then((d) => (d.error ? setListsError(d.error) : setLists(d.lists)))
      .catch(() => setListsError("Couldn't load ClickUp lists"));
  }, []);

  const run = (fn: () => Promise<void>) => startTransition(fn);
  const save = () =>
    run(async () => {
      try {
        await onSave(clientId, form);
        setMessage({ text: "Saved", ok: true });
        router.refresh();
      } catch (e) {
        setMessage({ text: e instanceof Error ? e.message : "Couldn't save", ok: false });
      }
    });
  const test = () =>
    run(async () => {
      if (dirty) await onSave(clientId, form);
      const r = await onTest(clientId);
      setMessage("error" in r ? { text: `Slack: ${r.error}`, ok: false } : { text: "Test message sent to Slack", ok: true });
    });
  const createTask = () =>
    run(async () => {
      if (!task) return;
      const r = await onCreateTask(clientId, task);
      if ("error" in r) setMessage({ text: `ClickUp: ${r.error}`, ok: false });
      else {
        setMessage({ text: "ClickUp task created", ok: true });
        setTask(null);
      }
    });

  return (
    <div className="card rounded-2xl p-5 space-y-4">
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Integrations</p>

      <div className="space-y-2">
        <label className="block">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>Slack channel ID</span>
          <input value={form.slackChannelId} onChange={(e) => setForm({ ...form, slackChannelId: e.target.value })} placeholder="C0123ABCD" className="w-full px-2 py-1.5 rounded-lg text-sm outline-none mt-0.5" style={input} />
        </label>
        {(Object.keys(EVENT_LABELS) as (keyof Events)[]).map((k) => (
          <label key={k} className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={form.slackEvents[k]} onChange={(e) => setForm({ ...form, slackEvents: { ...form.slackEvents, [k]: e.target.checked } })} className="accent-[var(--primary)]" />
            {EVENT_LABELS[k]}
          </label>
        ))}
        <button onClick={test} disabled={pending || !form.slackChannelId.trim()} className="text-xs font-bold disabled:opacity-40" style={{ color: "var(--primary)" }}>
          Send test message
        </button>
      </div>

      <label className="block">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>ClickUp list</span>
        {lists ? (
          <select value={form.clickupListId} onChange={(e) => setForm({ ...form, clickupListId: e.target.value })} className="w-full px-2 py-1.5 rounded-lg text-sm outline-none mt-0.5" style={input}>
            <option value="">None</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        ) : (
          <p className="text-[11px] mt-0.5" style={{ color: listsError ? "var(--danger)" : "var(--text-muted)" }}>{listsError ?? "Loading lists…"}</p>
        )}
      </label>

      {dirty && (
        <button onClick={save} disabled={pending} className="btn-gradient px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
      )}

      {initial.clickupListId && (
        <div>
          {task ? (
            <div className="space-y-2">
              <input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} placeholder="Task title" className="w-full px-2 py-1.5 rounded-lg text-sm outline-none" style={input} aria-label="Task title" />
              <textarea value={task.description} onChange={(e) => setTask({ ...task, description: e.target.value })} rows={3} placeholder="Description" className="w-full px-2 py-1.5 rounded-lg text-sm outline-none resize-none" style={input} aria-label="Description" />
              <input type="date" value={task.due} onChange={(e) => setTask({ ...task, due: e.target.value })} className="px-2 py-1.5 rounded-lg text-sm outline-none" style={input} aria-label="Due date" />
              <div className="flex gap-2">
                <button onClick={createTask} disabled={pending || !task.title.trim()} className="btn-gradient px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50">Create task</button>
                <button onClick={() => setTask(null)} className="px-4 py-2 rounded-lg text-xs font-bold" style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setTask({ title: "", description: "", due: "" })} className="text-xs font-bold" style={{ color: "var(--primary)" }}>+ Create ClickUp task</button>
          )}
        </div>
      )}

      {message && <p className="text-xs" style={{ color: message.ok ? "var(--tag-green-fg)" : "var(--danger)" }}>{message.text}</p>}
    </div>
  );
}
