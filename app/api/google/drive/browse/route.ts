import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/google-sheets";
import { getDriveMeta, isFolder, isWithinDriveTree, listDriveChildren, parseDriveLink } from "@/lib/google-drive";

// Lists a client's Gameplan Drive link — a single file's metadata, or a
// folder's children — fetched through the app's own connected Google
// account instead of the viewer's browser. This is what lets a client see
// the Gameplan even when the Drive item isn't shared "Anyone with the
// link": the connected account just needs its own access.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const requestedId = req.nextUrl.searchParams.get("id") || undefined;
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const user = await requireUser();
  if (user.role === "CLIENT" && clientId !== user.clientId) {
    return NextResponse.json({ error: "Not authorized for this client" }, { status: 403 });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { gameplanFigmaLink: true } });
  const root = client?.gameplanFigmaLink ? parseDriveLink(client.gameplanFigmaLink) : null;
  if (!root) return NextResponse.json({ error: "No Gameplan link saved for this client" }, { status: 400 });

  try {
    const accessToken = await getValidAccessToken();

    const targetId = requestedId ?? root.id;
    if (targetId !== root.id && !(await isWithinDriveTree(accessToken, targetId, root.id))) {
      return NextResponse.json({ error: "Not within this client's Gameplan folder" }, { status: 403 });
    }

    const meta = await getDriveMeta(accessToken, targetId);
    if (isFolder(meta)) {
      const children = await listDriveChildren(accessToken, targetId);
      return NextResponse.json({ type: "folder", meta, children });
    }
    return NextResponse.json({ type: "file", meta });
  } catch (err: any) {
    console.error("Drive browse failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}
