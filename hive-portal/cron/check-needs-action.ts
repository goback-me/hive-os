// Run on the VPS cron, e.g. every 15 minutes:
//   */15 * * * * cd /root/automation/hive-portal && npx tsx cron/check-needs-action.ts >> /var/log/hive-portal-cron.log 2>&1
//
// Rebuilds the NeedsActionItem cache table so the dashboard never runs
// the rules queries live on page load.

import { computeNeedsAction } from "../lib/needs-action";

(async () => {
  const count = await computeNeedsAction();
  console.log(`[${new Date().toISOString()}] Needs Action recomputed — ${count} items`);
  process.exit(0);
})().catch((err) => {
  console.error("Needs Action cron failed:", err);
  process.exit(1);
});
