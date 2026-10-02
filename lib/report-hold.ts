import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { HOLD_TYPES } from "./data-health";

// While a report-breaking data problem is open (sheet/HQ mismatch, missing
// status column — lib/data-health.ts), a CLIENT sees "Data being updated"
// instead of numbers: wrong numbers are never shown. Coaches still see
// everything (plus the alert).
export async function reportsOnHold(clientId: string) {
  return (await prisma.dataAlert.count({ where: { clientId, status: "OPEN", type: { in: HOLD_TYPES } } })) > 0;
}

export const HOLD_MESSAGE = "Data being updated — your numbers will be back shortly.";

// For report API routes: the response to send a CLIENT instead, or null.
export async function holdResponse(user: { role: "COACH" | "CLIENT" }, clientId: string) {
  if (user.role !== "CLIENT" || !(await reportsOnHold(clientId))) return null;
  return NextResponse.json({ error: HOLD_MESSAGE, hold: true });
}
