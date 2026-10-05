// Who may see which client — pure, so it's testable (lib/auth.ts re-exports it).
// A coach: any client. An agent: the clients they run the weekly call for.
// A client: their own.
export type AccessUser = { role: "COACH" | "CLIENT"; isAgent: boolean; agentClientIds: string[]; clientId: string | null };

export function canAccessClient(user: AccessUser, clientId: string) {
  if (user.role === "CLIENT") return user.clientId === clientId;
  return !user.isAgent || user.agentClientIds.includes(clientId);
}
