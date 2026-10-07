// Who may see which client — pure, so it's testable (lib/auth.ts re-exports it).
// A coach: any client. An agent: the clients they run the weekly call for.
// A client: their own.
export type AccessUser = { role: "COACH" | "CLIENT"; isAgent: boolean; agentClientIds: string[]; clientId: string | null };

export function canAccessClient(user: AccessUser, clientId: string) {
  if (user.role === "CLIENT") return user.clientId === clientId;
  return !user.isAgent || user.agentClientIds.includes(clientId);
}

// Where Clerk sends a signed-out visitor after sign-in: the same path + query
// (an email's ?a= deep link included) on the app's public URL — behind
// Docker's port mapping the request only knows its internal host.
export function signInReturnUrl(reqUrl: string, publicBase: string | undefined) {
  const u = new URL(reqUrl);
  return publicBase ? new URL(u.pathname + u.search, publicBase).toString() : reqUrl;
}
