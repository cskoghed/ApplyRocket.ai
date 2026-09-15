import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createDocumentRecord, listDocumentRecords } from "@/lib/document-store";
import { validateUpload } from "@/lib/file-utils";
import type { DocumentKind } from "@/lib/types";

function unauthorizedResponse() {
  return NextResponse.json({ error: "Sign in to access documents." }, { status: 401 });
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isDocumentKind(value: unknown): value is DocumentKind {
  return value === "cv" || value === "attachment";
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const documents = await listDocumentRecords(user.id);
  return NextResponse.json({ documents });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid document payload." }, { status: 400 });
  }

  const candidate = body as Record<string, unknown>;
  if (
    !isString(candidate.name) ||
    !isDocumentKind(candidate.kind) ||
    !isString(candidate.type) ||
    typeof candidate.size !== "number" ||
    (candidate.extractedText !== undefined && !isString(candidate.extractedText))
  ) {
    return NextResponse.json({ error: "Invalid document payload." }, { status: 400 });
  }

  const validationError = validateUpload({ name: candidate.name, type: candidate.type, size: candidate.size } as File);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const document = await createDocumentRecord(
    randomUUID(),
    {
      name: candidate.name,
      kind: candidate.kind,
      type: candidate.type,
      size: candidate.size,
      extractedText: (candidate.extractedText as string | undefined) ?? ""
    },
    user.id
  );

  return NextResponse.json({ document }, { status: 201 });
}
