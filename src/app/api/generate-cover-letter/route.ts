import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { CoverLetterGenerationError, generateCoverLetterDraft } from "@/lib/cover-letter";
import { validateUpload } from "@/lib/file-utils";
import type { CoverLetterGenerationInput } from "@/lib/types";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isValidRequest(body: unknown): body is CoverLetterGenerationInput {
  if (!body || typeof body !== "object") {
    return false;
  }

  const candidate = body as Record<string, unknown>;
  const brief = candidate.brief as Record<string, unknown> | undefined;
  const documents = candidate.documents as Array<Record<string, unknown>> | undefined;

  return Boolean(
    brief &&
      isString(brief.role) &&
      isString(brief.company) &&
      isString(brief.location) &&
      isString(brief.tone) &&
      isString(brief.description) &&
      Array.isArray(documents) &&
      documents.every((document) => {
        const name = document.name;
        const kind = document.kind;
        const type = document.type;
        const size = document.size;
        const extractedText = document.extractedText;

        return (
          isString(name) &&
          isString(kind) &&
          isString(type) &&
          typeof size === "number" &&
          (extractedText === undefined || isString(extractedText)) &&
          validateUpload({ name, type, size } as File) === null
        );
      })
  );
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to generate cover letters." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!isValidRequest(body)) {
    return NextResponse.json({ error: "Invalid cover letter request." }, { status: 400 });
  }

  try {
    const draft = await generateCoverLetterDraft(body);
    return NextResponse.json({ draft });
  } catch (error) {
    if (error instanceof CoverLetterGenerationError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    throw error;
  }
}
