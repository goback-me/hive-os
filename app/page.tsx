import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

// Where sign-in lands: admins → the agency dashboard, account managers and
// agents → My Calls, a client → their own portal (middleware.ts).
export default async function Home() {
  const user = await requireUser();
  if (user.role === "CLIENT") redirect(user.clientSlug ? `/clients/${user.clientSlug}` : "/login?error=no-client");
  redirect(user.isAdmin ? "/dashboard" : "/my-calls");
}
