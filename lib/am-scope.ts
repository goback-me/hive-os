import { prisma } from "./prisma";
import type { CurrentUser } from "./auth";

// Whose clients Account Management shows. ?am= picks an account manager
// ("all" = everyone). Admins default to all, coaches to their own; agents only
// ever see their own clients.
export async function amScope(user: CurrentUser, amParam: string | null | undefined) {
  const me = (await prisma.user.findUnique({ where: { clerkId: user.clerkId }, select: { id: true } }))?.id ?? null;
  if (user.isAgent) return { am: me, clientIds: user.agentClientIds, value: me ?? "", canPick: false };
  const valid = amParam === "all" || (!!amParam && !!(await prisma.user.findFirst({ where: { id: amParam, role: { not: "CLIENT" } }, select: { id: true } })));
  const value = valid ? amParam! : user.isAdmin ? "all" : me ?? "all";
  return { am: value === "all" ? null : value, clientIds: undefined, value, canPick: true };
}
