import { NextResponse } from "next/server";
import { deleteWorkspaceRecord, readWorkspaceRecord, saveWorkspaceRecord } from "@/lib/workspace-store";
import type { WorkspaceSnapshot } from "@/lib/types";

function isSnapshot(body: unknown): body is WorkspaceSnapshot {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as Record<string, unknown>;
  return Boolean(candidate.brief && candidate.draft && Array.isArray(candidate.documents) && typeof candidate.editedContent === "string");
}

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const record = await readWorkspaceRecord(workspaceId);

  if (!record) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  return NextResponse.json({ workspace: record });
}

export async function PUT(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const body = await request.json().catch(() => null);

  if (!isSnapshot(body)) {
    return NextResponse.json({ error: "Invalid workspace payload." }, { status: 400 });
  }

  const workspace = await saveWorkspaceRecord(workspaceId, body);
  return NextResponse.json({ workspace });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const deleted = await deleteWorkspaceRecord(workspaceId);
  return NextResponse.json({ deleted });
}
