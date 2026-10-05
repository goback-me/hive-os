import { prisma } from "./prisma";
import { decryptToken } from "./crypto";
import { terms } from "./client-terms";

// Slack, via a bot token (chat.postMessage). Everything is queued in
// SlackPostLog first and sent by deliverSlackPosts — from the cron, and
// straight after an event — so a Slack outage never breaks a sync or a status
// change. Each post's dedupeKey makes it happen once.
//
// Token: the one saved by "Add to Slack" (Settings → Integrations), else the
// SLACK_BOT_TOKEN env. SLACK_ADMIN_CHANNEL = the agency's digest channel.

export type SlackEvents = { sales: boolean; liveTransfers: boolean; weeklyUpdates: boolean; dailyDigest: boolean };
export function parseSlackEvents(raw: unknown): SlackEvents {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const on = (k: keyof SlackEvents) => (typeof o[k] === "boolean" ? (o[k] as boolean) : true);
  return { sales: on("sales"), liveTransfers: on("liveTransfers"), weeklyUpdates: on("weeklyUpdates"), dailyDigest: on("dailyDigest") };
}

async function slackToken() {
  const s = await prisma.integrationSettings.findUnique({ where: { id: "singleton" }, select: { slackBotToken: true } });
  return s?.slackBotToken ? decryptToken(s.slackBotToken) : process.env.SLACK_BOT_TOKEN || null;
}
export const slackConfigured = async () => !!(await slackToken());

// "Add to Slack" OAuth (app/api/slack/*). Slack only accepts https redirect URLs.
export const SLACK_OAUTH_STATE_COOKIE = "slack_oauth_state";
export const slackRedirectUri = () => `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/slack/callback`;
const appUrl = () => process.env.NEXTAUTH_URL || "";

// Queue one post (no-op if it was already queued under this key).
export async function queueSlack(post: { clientId?: string | null; channel: string; kind: string; dedupeKey: string; text: string }) {
  if (!post.channel || !(await slackConfigured())) return false;
  const created = await prisma.slackPostLog.createMany({ data: [{ ...post, clientId: post.clientId ?? null }], skipDuplicates: true });
  return created.count > 0;
}

async function postMessage(token: string, channel: string, text: string) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error ?? `Slack ${res.status}`);
}

// Sends what's queued (oldest first); a failure is recorded on the row and
// retried up to 5 times by later runs. Never throws.
export async function deliverSlackPosts(limit = 50) {
  const token = await slackToken();
  if (!token) return { sent: 0, failed: 0 };
  const due = await prisma.slackPostLog.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 5 } }, orderBy: { createdAt: "asc" }, take: limit });
  let sent = 0;
  let failed = 0;
  for (const p of due) {
    try {
      await postMessage(token, p.channel, p.text);
      await prisma.slackPostLog.update({ where: { id: p.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, error: null } });
      sent++;
    } catch (e) {
      await prisma.slackPostLog.update({ where: { id: p.id }, data: { status: "FAILED", attempts: { increment: 1 }, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
      failed++;
    }
  }
  return { sent, failed };
}

export function kickSlack() {
  deliverSlackPosts(10).catch((e) => console.error("Slack delivery failed:", e));
}

async function clientChannel(clientId: string, event: keyof SlackEvents) {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true, slug: true, slackChannelId: true, slackEvents: true, clientType: true } });
  if (!c?.slackChannelId || !parseSlackEvents(c.slackEvents)[event]) return null;
  return c;
}

// ── Events ────────────────────────────────────────────────────────────────

// A lead just became Won (with a value) or a live transfer — from a sync or
// an HQ change. Once per lead per event, ever.
export async function queueLeadEvent(leadId: string, event: "sale" | "live_transfer") {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clientId: true, name: true, campaign: true, value: true, createdAt: true, stage: true } });
  if (!lead) return;
  const c = await clientChannel(lead.clientId, event === "sale" ? "sales" : "liveTransfers");
  if (!c) return;
  // Plain sentences — these go to the client's own channel.
  const who = lead.name?.trim() || "A new lead";
  let text: string;
  if (event === "sale") {
    if (lead.value == null) return; // a sale is posted once it has its value
    const days = Math.max(0, Math.round((Date.now() - lead.createdAt.getTime()) / 86_400_000));
    const after = days === 0 ? "the same day they enquired" : `${days} day${days === 1 ? "" : "s"} after they first enquired`;
    text = `:tada: *New ${terms(c.clientType).sale.toLowerCase()} for ${c.name}!* ${who} — *$${Number(lead.value).toLocaleString("en-US")}*, ${after}.`;
  } else {
    text = `:telephone_receiver: *New live transfer for ${c.name}.* ${who} was just put through to you on the phone.`;
  }
  await queueSlack({ clientId: lead.clientId, channel: c.slackChannelId!, kind: event, dedupeKey: `${event}:${leadId}`, text });
}

export async function queueWeeklyUpdatePost(updateId: string) {
  const u = await prisma.weeklyUpdate.findUnique({ where: { id: updateId } });
  if (!u) return;
  const c = await clientChannel(u.clientId, "weeklyUpdates");
  if (!c) return;
  const week = u.weekOf.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" });
  const section = (label: string, body: string) => (body.trim() ? `*${label}*\n${body.trim()}` : null);
  const text = [
    `:memo: *Here's this week's update for ${c.name}* (week of ${week}, from ${u.createdBy})`,
    section("What went well", u.wins),
    section("What's getting in the way", u.issues),
    section("What happens next", u.nextSteps),
    `<${appUrl()}/clients/${c.slug}?tab=dashboard|See it in Hive HQ>`,
  ]
    .filter(Boolean)
    .join("\n\n");
  await queueSlack({ clientId: u.clientId, channel: c.slackChannelId!, kind: "weekly_update", dedupeKey: `weekly_update:${u.id}`, text });
}

export async function queueTestMessage(clientId: string) {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true, slackChannelId: true } });
  if (!c?.slackChannelId) throw new Error("Set a Slack channel ID first");
  const token = await slackToken();
  if (!token) throw new Error("Slack isn't connected — use Add to Slack in Settings → Integrations");
  // Sent straight away so the coach sees the result.
  await postMessage(token, c.slackChannelId, `:wave: Hive HQ is connected to this channel for *${c.name}*.`);
}
