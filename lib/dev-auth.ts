// Local development only: DEV_SKIP_AUTH=1 skips Clerk sign-in entirely and
// treats every visitor as an admin (middleware.ts + lib/auth.ts). It can
// never apply in production: NODE_ENV=production (next build / next start,
// the Docker image) turns it off whatever the env var says.
export const devAuthBypass = () => process.env.NODE_ENV !== "production" && process.env.DEV_SKIP_AUTH === "1";

export const DEV_USER = {
  id: "dev-admin",
  clerkId: "dev-admin",
  email: "dev@localhost",
  name: "Dev Admin",
  role: "COACH" as const,
  isAdmin: true,
  isAgent: false,
  agentClientIds: [] as string[],
  clientId: null,
  clientSlug: null,
};
