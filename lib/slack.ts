import { prisma } from "./prisma";
import { terms } from "./client-terms";

// Slack, via a bot token (chat.postMessage). Everything is queued in
// SlackPostLog first and sent by deliverSlackPosts — from the cron, and
// straight after an event — so a Slack outage never breaks a sync or a status
// change. Each post's dedupeKey makes it happen once.
//
// Env: SLACK_BOT_TOKEN (bot with chat:write, invited to each channel),
//      SLACK_ADMIN_CHANNEL (the agency's portfolio digest channel).

export type SlackEvents = { sales: boolean; liveTransfers: boolean; weeklyUpdates: boolean; dailyDigest: boolean };
export const SLACK_EVENT_LABELS: Record<keyof SlackEvents, string> = {
  sales: "New sale",
  liveTransfers: "New live transfer",
  weeklyUpdates: "Weekly update published",
  dailyDigest: "Daily 8am digest",
};
export function parseSlackEvents(raw: unknown): SlackEvents {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const on = (k: keyof SlackEvents) => (typeof o[k] === "boolean" ? (o[k] as boolean) : true);
  return { sales: on("sales"), liveTransfers: on("liveTransfers"), weeklyUpdates: on("weeklyUpdates"), dailyDigest: on("dailyDigest") };
}

export const slackConfigured = () => !!process.env.SLACK_BOT_TOKEN;
const appUrl = () => process.env.NEXTAUTH_URL || "";

// Queue one post (no-op if it was already queued under this key).
export async function queueSlack(post: { clientId?: string | null; channel: string; kind: string; dedupeKey: string; text: string }) {
  if (!slackConfigured() || !post.channel) return false;
  const created = await prisma.slackPostLog.createMany({ data: [{ ...post, clientId: post.clientId ?? null }], skipDuplicates: true });
  return created.count > 0;
}

async function postMessage(channel: string, text: string) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error ?? `Slack ${res.status}`);
}

// Sends what's queued (oldest first); a failure is recorded on the row and
// retried up to 5 times by later runs. Never throws.
export async function deliverSlackPosts(limit = 50) {
  if (!slackConfigured()) return { sent: 0, failed: 0 };
  const due = await prisma.slackPostLog.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: 5 } }, orderBy: { createdAt: "asc" }, take: limit });
  let sent = 0;
  let failed = 0;
  for (const p of due) {
    try {
      await postMessage(p.channel, p.text);
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
  const who = lead.name || "A lead";
  const campaign = lead.campaign?.trim() ? ` · ${lead.campaign.trim()}` : "";
  let text: string;
  if (event === "sale") {
    if (lead.value == null) return; // a sale is posted once it has its value
    const days = Math.max(0, Math.round((Date.now() - lead.createdAt.getTime()) / 86_400_000));
    text = `:tada: *New ${terms(c.clientType).sale.toLowerCase()}* — ${who}${campaign} · *$${Number(lead.value).toLocaleString("en-US")}* · ${days} day${days === 1 ? "" : "s"} from lead to won`;
  } else {
    text = `:telephone_receiver: *New live transfer* — ${who}${campaign}`;
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
  const text = [`:memo: *Weekly update — week of ${week}* (${u.createdBy})`, section("Wins", u.wins), section("Issues", u.issues), section("Next steps", u.nextSteps), `<${appUrl()}/clients/${c.slug}?tab=dashboard|Open in Hive HQ>`]
    .filter(Boolean)
    .join("\n\n");
  await queueSlack({ clientId: u.clientId, channel: c.slackChannelId!, kind: "weekly_update", dedupeKey: `weekly_update:${u.id}`, text });
}

export async function queueTestMessage(clientId: string) {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true, slackChannelId: true } });
  if (!c?.slackChannelId) throw new Error("Set a Slack channel ID first");
  if (!slackConfigured()) throw new Error("SLACK_BOT_TOKEN isn't set on the server");
  // Sent straight away so the coach sees the result.
  await postMessage(c.slackChannelId, `:wave: Hive HQ is connected to this channel for *${c.name}*.`);
}
