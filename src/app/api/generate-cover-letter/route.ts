import { NextResponse } from "next/server";
import { generateCoverLetterDraft } from "@/lib/cover-letter";
import type { CoverLetterGenerationInput } from "@/lib/types";
import { validateUpload } from "@/lib/file-utils";

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
        const preview = document.preview;
        const extractedText = document.extractedText;

        return (
          isString(name) &&
          isString(kind) &&
          isString(type) &&
          typeof size === "number" &&
          isString(preview) &&
          (extractedText === undefined || isString(extractedText)) &&
          validateUpload({ name, type, size } as File) === null
        );
      })
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!isValidRequest(body)) {
    return NextResponse.json({ error: "Invalid cover letter request." }, { status: 400 });
  }

  const draft = await generateCoverLetterDraft(body);
  return NextResponse.json({ draft });
}
