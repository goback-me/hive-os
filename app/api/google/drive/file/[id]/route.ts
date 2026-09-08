import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/google-sheets";
import { fetchDriveFileContent, getDriveMeta, isGoogleNativeType, isWithinDriveTree, parseDriveLink } from "@/lib/google-drive";

// Streams a single Drive file's content through the connected Google
// account — Docs/Sheets/Slides are exported to PDF (they have no binary
// content of their own), everything else is downloaded as-is.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = req.nextUrl.searchParams.get("clientId");
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

    const fileId = params.id;
    if (fileId !== root.id && !(await isWithinDriveTree(accessToken, fileId, root.id))) {
      return NextResponse.json({ error: "Not within this client's Gameplan folder" }, { status: 403 });
    }

    const meta = await getDriveMeta(accessToken, fileId);
    const upstream = await fetchDriveFileContent(accessToken, meta);

    const contentType = isGoogleNativeType(meta.mimeType) ? "application/pdf" : meta.mimeType;
    const filename = isGoogleNativeType(meta.mimeType) ? `${meta.name}.pdf` : meta.name;

    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err: any) {
    console.error("Drive file fetch failed:", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}
