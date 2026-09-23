import { NextResponse } from "next/server";
import { ApplicationAccessError, deleteApplicationRecord, readApplicationRecord, saveApplicationRecord } from "@/lib/application-store";
import { getAuthenticatedUser } from "@/lib/auth";
import { isCoverLetterChatMessageList } from "@/lib/chat-messages";
import { readDocumentRecords } from "@/lib/document-store";
import type { ApplicationSnapshot } from "@/lib/types";

function isSnapshot(body: unknown): body is ApplicationSnapshot {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as Record<string, unknown>;
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

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to access applications." }, { status: 401 });
}

export async function GET(_request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { applicationId } = await params;
  const record = await readApplicationRecord(applicationId, user.id);

  if (!record) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  return NextResponse.json({ application: record });
}

export async function PUT(request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { applicationId } = await params;
  const body = await request.json().catch(() => null);

  if (!isSnapshot(body)) {
    return NextResponse.json({ error: "Invalid application payload." }, { status: 400 });
  }

  try {
    const ownedDocuments = await readDocumentRecords(body.documentIds, user.id);
    const snapshot: ApplicationSnapshot = { ...body, documentIds: ownedDocuments.map((document) => document.id) };
    const application = await saveApplicationRecord(applicationId, snapshot, user.id);
    return NextResponse.json({ application });
  } catch (error) {
    if (error instanceof ApplicationAccessError) {
      return NextResponse.json({ error: "Application not found." }, { status: 404 });
    }

    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { applicationId } = await params;
  const deleted = await deleteApplicationRecord(applicationId, user.id);
  return NextResponse.json({ deleted });
}
