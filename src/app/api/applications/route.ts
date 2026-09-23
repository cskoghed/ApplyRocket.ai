import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { listApplicationRecords, saveApplicationRecord } from "@/lib/application-store";
import { isCoverLetterChatMessageList } from "@/lib/chat-messages";
import { readDocumentRecords } from "@/lib/document-store";
import type { ApplicationSnapshot } from "@/lib/types";

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to access applications." }, { status: 401 });
}

function isValidSnapshotShape(candidate: Record<string, unknown>): candidate is Record<string, unknown> & ApplicationSnapshot {
  return Boolean(
    candidate.brief &&
      candidate.draft &&
      Array.isArray(candidate.documentIds) &&
      candidate.documentIds.every((id) => typeof id === "string") &&
      typeof candidate.editedContent === "string" &&
      (candidate.chatMessages === undefined || isCoverLetterChatMessageList(candidate.chatMessages)) &&
      (candidate.chatActiveLeafId === undefined ||
        candidate.chatActiveLeafId === null ||
        typeof candidate.chatActiveLeafId === "string")
  );
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const applications = await listApplicationRecords(user.id);
  return NextResponse.json({ applications });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !isValidSnapshotShape(body as Record<string, unknown>)) {
    return NextResponse.json({ error: "Invalid application payload." }, { status: 400 });
  }

  const candidate = body as ApplicationSnapshot;
  const ownedDocuments = await readDocumentRecords(candidate.documentIds, user.id);
  const snapshot: ApplicationSnapshot = { ...candidate, documentIds: ownedDocuments.map((document) => document.id) };

  const application = await saveApplicationRecord(randomUUID(), snapshot, user.id);
  return NextResponse.json({ application }, { status: 201 });
}
