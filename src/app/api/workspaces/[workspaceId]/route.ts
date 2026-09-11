import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { deleteWorkspaceRecord, readWorkspaceRecord, saveWorkspaceRecord, WorkspaceAccessError } from "@/lib/workspace-store";
import type { WorkspaceSnapshot } from "@/lib/types";

function isSnapshot(body: unknown): body is WorkspaceSnapshot {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as Record<string, unknown>;
  return Boolean(candidate.brief && candidate.draft && Array.isArray(candidate.documents) && typeof candidate.editedContent === "string");
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to access workspaces." }, { status: 401 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { workspaceId } = await params;
  const record = await readWorkspaceRecord(workspaceId, user.id);

  if (!record) {
    return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  }

  return NextResponse.json({ workspace: record });
}

export async function PUT(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { workspaceId } = await params;
  const body = await request.json().catch(() => null);

  if (!isSnapshot(body)) {
    return NextResponse.json({ error: "Invalid workspace payload." }, { status: 400 });
  }

  try {
    const workspace = await saveWorkspaceRecord(workspaceId, body, user.id);
    return NextResponse.json({ workspace });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
    }

    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { workspaceId } = await params;
  const deleted = await deleteWorkspaceRecord(workspaceId, user.id);
  return NextResponse.json({ deleted });
}
