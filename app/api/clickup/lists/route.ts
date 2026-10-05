import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listClickUpLists, listClickUpMembers, listClickUpTargets } from "@/lib/clickup";

// The connected ClickUp workspace's lists — for picking a client's list —
// and where "Create ClickUp folder" can put a client (spaces / shared folders).
export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "COACH" || user.isAgent) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  try {
    const [lists, spaces, members] = await Promise.all([listClickUpLists(), listClickUpTargets().catch(() => []), listClickUpMembers().catch(() => [])]);
    return NextResponse.json({ lists, spaces, members });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp request failed" });
  }
}
