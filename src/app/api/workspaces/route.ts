import { NextResponse } from "next/server";
import { listWorkspaceRecords, saveWorkspaceRecord } from "@/lib/workspace-store";
import type { WorkspaceSnapshot } from "@/lib/types";

export async function GET() {
  const workspaces = await listWorkspaceRecords();
  return NextResponse.json({ workspaces });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid workspace payload." }, { status: 400 });
  }

  const candidate = body as Record<string, unknown>;
  if (!candidate.brief || !candidate.draft || !Array.isArray(candidate.documents) || typeof candidate.editedContent !== "string") {
    return NextResponse.json({ error: "Invalid workspace payload." }, { status: 400 });
  }

  const workspace = await saveWorkspaceRecord(crypto.randomUUID(), candidate as WorkspaceSnapshot);
  return NextResponse.json({ workspace }, { status: 201 });
}
