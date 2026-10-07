import { redirect } from "next/navigation";

// My Calls became Account Management — old links (call emails' ?update=) keep working.
export default function MyCallsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const q = new URLSearchParams(Object.entries(searchParams).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
  redirect(`/account-management${q ? `?${q}` : ""}`);
}
