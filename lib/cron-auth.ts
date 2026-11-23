import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

// The cron routes are public at the routing level (middleware.ts); the
// x-cron-secret header matching CRON_SECRET is their only auth.
export function cronAuthorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const given = req.headers.get("x-cron-secret");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
