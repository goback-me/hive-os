import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listClickUpLists } from "@/lib/clickup";

// The connected ClickUp workspace's lists — for picking a client's list.
export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "COACH" || user.isAgent) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  try {
    return NextResponse.json({ lists: await listClickUpLists() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ClickUp request failed" });
  }
}
