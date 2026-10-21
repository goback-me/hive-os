import { prisma } from "./prisma";

// Agency-wide ticks (Settings → Integrations → Automations): what HQ posts to
// the main Slack channel and which ClickUp tasks it makes on its own. Missing
// keys = the default here. Posts to a client's own channel are ticked per
// client (Client.slackEvents); manual ClickUp tasks always go through.
export const AUTOMATIONS = {
  adminDigest: { group: "Main Slack channel", label: "Weekly summary of every client (Monday 8am)", default: true },
  callMissed: { group: "Main Slack channel", label: "A client call didn't happen", default: true },
  referrals: { group: "Main Slack channel", label: "New referral", default: true },
  accountReview: { group: "ClickUp tasks", label: "Urgent: account review when a client goes red", default: true },
  dataAlerts: { group: "ClickUp tasks", label: "Urgent: fix a serious data problem", default: true },
  chaseClient: { group: "ClickUp tasks", label: "Chase a client for overdue lead updates (weekly)", default: false },
  weeklyUpdate: { group: "ClickUp tasks", label: "Write the weekly update (every client, every week)", default: false },
} as const;
export type AutomationKey = keyof typeof AUTOMATIONS;
export type Automations = Record<AutomationKey, boolean>;

export function parseAutomations(raw: unknown): Automations {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as Automations;
  for (const k of Object.keys(AUTOMATIONS) as AutomationKey[]) out[k] = typeof o[k] === "boolean" ? (o[k] as boolean) : AUTOMATIONS[k].default;
  return out;
}

// Slack post kind / ClickUp task kind → its tick. Kinds not listed always go.
const BY_KIND: Record<string, AutomationKey> = {
  admin_digest: "adminDigest",
  meeting_missed: "callMissed",
  referral: "referrals",
  account_review: "accountReview",
  alert: "dataAlerts",
  chase_client: "chaseClient",
  weekly_update: "weeklyUpdate",
};

export async function automationOn(kind: string) {
  const k = BY_KIND[kind];
  if (!k) return true;
  const s = await prisma.integrationSettings.findUnique({ where: { id: "singleton" }, select: { automations: true } });
  return parseAutomations(s?.automations)[k];
}
