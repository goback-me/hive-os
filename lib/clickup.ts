import { prisma } from "./prisma";

// ClickUp tasks for the account team, created in each client's ClickUp list
// (Client.clickupListId) with the API key + team saved under Settings →
// Integrations. Every task is logged in ClickUpTaskLog under a dedupe key so
// it's made once; alert tasks close when their alert resolves. A failure is
// logged (and becomes a CLICKUP_FAILED warning) — it never blocks anything.

const API = "https://api.clickup.com/api/v2";

async function config() {
  const s = await prisma.integrationSettings.findUnique({ where: { id: "singleton" } });
  return s?.clickupApiKey ? { key: s.clickupApiKey, teamId: s.clickupTeamId } : null;
}

async function call<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: key, "Content-Type": "application/json", ...(init.headers ?? {}) }, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.err ?? `ClickUp ${res.status}`);
  return data as T;
}

// Every list in the connected workspace, labelled "Space / Folder / List" —
// for the client settings picker.
export async function listClickUpLists(): Promise<{ id: string; name: string }[]> {
  const c = await config();
  if (!c?.teamId) throw new Error("Add the ClickUp API key and Team ID under Settings → Integrations");
  type L = { id: string; name: string };
  const { spaces } = await call<{ spaces: L[] }>(c.key, `/team/${c.teamId}/space?archived=false`);
  const out: { id: string; name: string }[] = [];
  for (const space of spaces) {
    const [{ folders }, { lists }] = await Promise.all([
      call<{ folders: (L & { lists: L[] })[] }>(c.key, `/space/${space.id}/folder?archived=false`),
      call<{ lists: L[] }>(c.key, `/space/${space.id}/list?archived=false`),
    ]);
    for (const l of lists) out.push({ id: l.id, name: `${space.name} / ${l.name}` });
    for (const f of folders) for (const l of f.lists) out.push({ id: l.id, name: `${space.name} / ${f.name} / ${l.name}` });
  }
  return out;
}

// Team members, for the Settings mapping (User.clickupUserId).
export async function listClickUpMembers(): Promise<{ id: string; name: string }[]> {
  const c = await config();
  if (!c?.teamId) throw new Error("ClickUp isn't set up");
  const { team } = await call<{ team: { members: { user: { id: number; username: string | null; email: string } }[] } }>(c.key, `/team/${c.teamId}`);
  return team.members.map((m) => ({ id: String(m.user.id), name: m.user.username || m.user.email }));
}

type Task = { kind: string; dedupeKey: string; title: string; description: string; dueDate?: Date | null; assignees?: string[] };

// Create a task once per dedupeKey (a failed attempt is retried next time).
export async function ensureTask(clientId: string, t: Task): Promise<string | null> {
  const existing = await prisma.clickUpTaskLog.findUnique({ where: { dedupeKey: t.dedupeKey } });
  if (existing && existing.status !== "FAILED") return existing.taskId;
  const [c, client] = await Promise.all([config(), prisma.client.findUnique({ where: { id: clientId }, select: { clickupListId: true } })]);
  if (!c || !client?.clickupListId) return null; // not set up for this client — nothing to do
  const log = existing ?? (await prisma.clickUpTaskLog.create({ data: { clientId, kind: t.kind, dedupeKey: t.dedupeKey, title: t.title } }));
  try {
    const task = await call<{ id: string; url: string }>(c.key, `/list/${client.clickupListId}/task`, {
      method: "POST",
      body: JSON.stringify({
        name: t.title,
        markdown_description: t.description,
        ...(t.dueDate ? { due_date: t.dueDate.getTime(), due_date_time: true } : {}),
        ...(t.assignees?.length ? { assignees: t.assignees.map(Number) } : {}),
      }),
    });
    await prisma.clickUpTaskLog.update({ where: { id: log.id }, data: { taskId: task.id, taskUrl: task.url, status: "SENT", error: null } });
    return task.id;
  } catch (e) {
    await prisma.clickUpTaskLog.update({ where: { id: log.id }, data: { status: "FAILED", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
    return null;
  }
}

// A task we made: new description, then closed — e.g. a logged weekly call.
// A failure is recorded on its ClickUpTaskLog row (→ CLICKUP_FAILED warning);
// it never throws.
export async function finishTask(taskId: string, description: string) {
  const c = await config();
  if (!c) return false;
  try {
    await call(c.key, `/task/${taskId}`, { method: "PUT", body: JSON.stringify({ description }) });
    await closeTask(c.key, taskId);
    await prisma.clickUpTaskLog.updateMany({ where: { taskId }, data: { closedAt: new Date() } });
    return true;
  } catch (e) {
    await prisma.clickUpTaskLog.updateMany({ where: { taskId }, data: { status: "FAILED", error: `Update failed: ${e instanceof Error ? e.message : e}`.slice(0, 300) } });
    return false;
  }
}

export async function commentOnTask(taskId: string, text: string) {
  const c = await config();
  if (!c) return false;
  try {
    await call(c.key, `/task/${taskId}/comment`, { method: "POST", body: JSON.stringify({ comment_text: text, notify_all: true }) });
    return true;
  } catch (e) {
    await prisma.clickUpTaskLog.updateMany({ where: { taskId }, data: { status: "FAILED", error: `Comment failed: ${e instanceof Error ? e.message : e}`.slice(0, 300) } });
    return false;
  }
}

// Move a task to its list's "closed" (else "done") status.
async function closeTask(key: string, taskId: string) {
  const task = await call<{ list: { id: string } }>(key, `/task/${taskId}`);
  const list = await call<{ statuses: { status: string; type: string }[] }>(key, `/list/${task.list.id}`);
  const closed = list.statuses.find((s) => s.type === "closed") ?? list.statuses.find((s) => s.type === "done");
  if (!closed) throw new Error("The ClickUp list has no closed status");
  await call(key, `/task/${taskId}`, { method: "PUT", body: JSON.stringify({ status: closed.status }) });
}

const appUrl = () => process.env.NEXTAUTH_URL || "";

// After every health check: a task for each serious data problem and for
// overdue client updates; tasks whose alert has since resolved are closed.
export async function syncAlertTasks(clientId: string) {
  const c = await config();
  if (!c) return;
  const alerts = await prisma.dataAlert.findMany({ where: { clientId, OR: [{ severity: "DANGER" }, { type: "CLIENT_UPDATE_OVERDUE" }] } });
  // CLIENT_UPDATE_OVERDUE doesn't open one here — the weekly "Chase client"
  // task comes from the reminders (lib/reminders.ts). Its old alert tasks
  // still close below.
  for (const a of alerts.filter((x) => x.status === "OPEN" && !x.clickupTaskId && x.type !== "CLIENT_UPDATE_OVERDUE")) {
    const taskId = await ensureTask(clientId, {
      kind: "alert",
      dedupeKey: `alert:${a.id}:${a.firstSeenAt.getTime()}`,
      title: `Fix data: ${a.title}`,
      description: `${a.detail}\n\n**Fix:** ${a.fixHint}${a.fixUrl ? `\n\n${appUrl()}${a.fixUrl}` : ""}`,
    });
    if (taskId) await prisma.dataAlert.update({ where: { id: a.id }, data: { clickupTaskId: taskId } });
  }
  for (const a of alerts.filter((x) => x.status === "RESOLVED" && x.clickupTaskId)) {
    const log = await prisma.clickUpTaskLog.findFirst({ where: { taskId: a.clickupTaskId, closedAt: null } });
    try {
      await closeTask(c.key, a.clickupTaskId!);
      if (log) await prisma.clickUpTaskLog.update({ where: { id: log.id }, data: { closedAt: new Date() } });
      await prisma.dataAlert.update({ where: { id: a.id }, data: { clickupTaskId: null } }); // done with it
    } catch (e) {
      if (log) await prisma.clickUpTaskLog.update({ where: { id: log.id }, data: { status: "FAILED", error: `Close failed: ${e instanceof Error ? e.message : e}`.slice(0, 300) } });
    }
  }
}
