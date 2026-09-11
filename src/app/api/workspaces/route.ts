import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { listWorkspaceRecords, saveWorkspaceRecord } from "@/lib/workspace-store";
import type { WorkspaceSnapshot } from "@/lib/types";

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to access workspaces." }, { status: 401 });
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const workspaces = await listWorkspaceRecords(user.id);
  return NextResponse.json({ workspaces });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid workspace payload." }, { status: 400 });
  }

  const candidate = body as Record<string, unknown>;
  if (!candidate.brief || !candidate.draft || !Array.isArray(candidate.documents) || typeof candidate.editedContent !== "string") {
    return NextResponse.json({ error: "Invalid workspace payload." }, { status: 400 });
  }

  const workspace = await saveWorkspaceRecord(crypto.randomUUID(), candidate as WorkspaceSnapshot, user.id);
  return NextResponse.json({ workspace }, { status: 201 });
}
