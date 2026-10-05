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

// What the key's account can see: the spaces it's a member of, plus what's
// been shared with it directly ("Shared with me" — all a guest account gets).
type L = { id: string; name: string };
type Shared = { lists: (L & { permission_level?: string })[]; folders: (L & { permission_level?: string; lists?: L[] })[] };
async function visible(c: { key: string; teamId: string | null }) {
  if (!c.teamId) throw new Error("Add the ClickUp API key and Team ID under Settings → Integrations");
  const [{ spaces }, { shared }] = await Promise.all([
    call<{ spaces: L[] }>(c.key, `/team/${c.teamId}/space?archived=false`),
    call<{ shared: Shared }>(c.key, `/team/${c.teamId}/shared`).catch(() => ({ shared: { lists: [], folders: [] } as Shared })),
  ]);
  return { spaces, shared };
}

// Every list the key can use, labelled "Space / Folder / List" (or
// "Shared / …") — for the client settings picker.
export async function listClickUpLists(): Promise<{ id: string; name: string }[]> {
  const c = await config();
  if (!c) throw new Error("Add the ClickUp API key and Team ID under Settings → Integrations");
  const { spaces, shared } = await visible(c);
  const out: { id: string; name: string }[] = [];
  for (const space of spaces) {
    const [{ folders }, { lists }] = await Promise.all([
      call<{ folders: (L & { lists: L[] })[] }>(c.key, `/space/${space.id}/folder?archived=false`),
      call<{ lists: L[] }>(c.key, `/space/${space.id}/list?archived=false`),
    ]);
    for (const l of lists) out.push({ id: l.id, name: `${space.name} / ${l.name}` });
    for (const f of folders) for (const l of f.lists) out.push({ id: l.id, name: `${space.name} / ${f.name} / ${l.name}` });
  }
  for (const f of shared.folders) {
    const lists = f.lists ?? (await call<{ lists: L[] }>(c.key, `/folder/${f.id}/list?archived=false`).catch(() => ({ lists: [] as L[] }))).lists;
    for (const l of lists) out.push({ id: l.id, name: `Shared / ${f.name} / ${l.name}` });
  }
  for (const l of shared.lists) out.push({ id: l.id, name: `Shared / ${l.name}` });
  const seen = new Set<string>();
  return out.filter((l) => !seen.has(l.id) && !!seen.add(l.id));
}

// Where "Create ClickUp folder" can put a client: a space (a real folder
// with the lists) or a folder shared with the account (a guest can't make
// folders, but can add lists there). id = "space:<id>" | "folder:<id>".
export async function listClickUpTargets(): Promise<{ id: string; name: string }[]> {
  const c = await config();
  if (!c) throw new Error("Add the ClickUp API key and Team ID under Settings → Integrations");
  const { spaces, shared } = await visible(c);
  const canCreate = (p?: string) => !p || ["create", "edit"].includes(p);
  const targets = [
    ...spaces.map((s) => ({ id: `space:${s.id}`, name: `Space: ${s.name}` })),
    ...shared.folders.filter((f) => canCreate(f.permission_level)).map((f) => ({ id: `folder:${f.id}`, name: `Shared folder: ${f.name}` })),
  ];
  if (!targets.length) {
    throw new Error("The ClickUp key's account can't see any space or shared folder to create lists in — share a folder with it (Full edit / Create), make it a Member, or use an admin's API key");
  }
  return targets;
}

// A client's own lists — Account / Client / Other. In a space: a folder
// named after the client holding them. In a shared folder (guest accounts):
// "<client> – Account" etc. inside it. Re-running reuses what's there and
// only adds what's missing. HQ's tasks go to the Account list.
export const CLIENT_FOLDER_LISTS = ["Account", "Client", "Other"] as const;

export async function createClientFolder(target: string, clientName: string): Promise<{ folderId: string; lists: Record<string, string> }> {
  const c = await config();
  if (!c) throw new Error("Add the ClickUp API key under Settings → Integrations");
  const [kind, id] = target.split(":");
  if (!id || (kind !== "space" && kind !== "folder")) throw new Error("Pick where to create it");
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  let folderId = id;
  let existingLists: L[];
  let listName: (n: string) => string;
  if (kind === "space") {
    const { folders } = await call<{ folders: (L & { lists: L[] })[] }>(c.key, `/space/${id}/folder?archived=false`);
    const folder = folders.find((f) => same(f.name, clientName)) ?? { ...(await call<L>(c.key, `/space/${id}/folder`, { method: "POST", body: JSON.stringify({ name: clientName }) })), lists: [] as L[] };
    folderId = folder.id;
    existingLists = folder.lists;
    listName = (n) => n;
  } else {
    existingLists = (await call<{ lists: L[] }>(c.key, `/folder/${id}/list?archived=false`)).lists;
    listName = (n) => `${clientName} – ${n}`;
  }
  const lists: Record<string, string> = {};
  for (const n of CLIENT_FOLDER_LISTS) {
    const name = listName(n);
    lists[n] = existingLists.find((l) => same(l.name, name))?.id ?? (await call<L>(c.key, `/folder/${folderId}/list`, { method: "POST", body: JSON.stringify({ name }) })).id;
  }
  return { folderId, lists };
}

// Team members, for the Settings mapping (User.clickupUserId).
export async function listClickUpMembers(): Promise<{ id: string; name: string }[]> {
  const c = await config();
  if (!c?.teamId) throw new Error("ClickUp isn't set up");
  const { team } = await call<{ team: { members: { user: { id: number; username: string | null; email: string } }[] } }>(c.key, `/team/${c.teamId}`);
  return team.members.map((m) => ({ id: String(m.user.id), name: m.user.username || m.user.email }));
}

// `why` = the task's purpose in one sentence — every task says which client
// and why it exists, so nobody has to guess (see taskText).
type Task = { kind: string; dedupeKey: string; title: string; why: string; description: string; dueDate?: Date | null; assignees?: string[] };

// "[Client] Title", and a description that opens with the client, why the
// task exists and a link to the client in HQ.
export function taskText(client: { name: string; slug: string }, t: Pick<Task, "kind" | "title" | "why" | "description">, base = appUrl()) {
  const prefix = `[${client.name}]`;
  return {
    title: t.title.startsWith(prefix) ? t.title : `${prefix} ${t.title}`,
    description: [
      `**Client:** ${client.name}`,
      `**Why this task:** ${t.why}`,
      `**Open in Hive HQ:** ${base}/clients/${client.slug}`,
      "",
      t.description.trim(),
      "",
      t.kind === "manual" ? "_Created in Hive HQ._" : "_Created automatically by Hive HQ._",
    ].join("\n"),
  };
}

// Create a task once per dedupeKey (a failed attempt is retried next time).
export async function ensureTask(clientId: string, t: Task): Promise<string | null> {
  const existing = await prisma.clickUpTaskLog.findUnique({ where: { dedupeKey: t.dedupeKey } });
  if (existing && existing.status !== "FAILED") return existing.taskId;
  const [c, client] = await Promise.all([config(), prisma.client.findUnique({ where: { id: clientId }, select: { name: true, slug: true, clickupListId: true, clickupAssigneeIds: true } })]);
  // Who it's for: the task's own (e.g. the call agent), else the client's default assignees.
  const assignees = t.assignees?.length ? t.assignees : client?.clickupAssigneeIds ?? [];
  if (!c || !client?.clickupListId) return null; // not set up for this client — nothing to do
  const text = taskText(client, t);
  const log = existing ?? (await prisma.clickUpTaskLog.create({ data: { clientId, kind: t.kind, dedupeKey: t.dedupeKey, title: text.title } }));
  try {
    const task = await call<{ id: string; url: string }>(c.key, `/list/${client.clickupListId}/task`, {
      method: "POST",
      body: JSON.stringify({
        name: text.title,
        markdown_description: text.description,
        ...(t.dueDate ? { due_date: t.dueDate.getTime(), due_date_time: true } : {}),
        ...(assignees.length ? { assignees: assignees.map(Number) } : {}),
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
      title: `Fix data — ${a.title}`,
      why: "Hive HQ found a problem that makes this client's numbers wrong or stale. This task closes itself once it's fixed.",
      description: `**What's wrong:** ${a.detail}\n\n**How to fix it:** ${a.fixHint}${a.fixUrl ? `\n\n${appUrl()}${a.fixUrl}` : ""}`,
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
