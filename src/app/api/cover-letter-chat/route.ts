import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  CoverLetterChatError,
  MAX_HISTORY_CONTENT_CHARS,
  MAX_HISTORY_TURNS,
  MAX_INSTRUCTION_CHARS,
  MAX_LETTER_CHARS,
  MAX_SELECTION_CHARS,
  streamCoverLetterRevision,
  type CoverLetterRevisionRequest
} from "@/lib/cover-letter-chat";
import type { CoverLetterChatTurn, JobBrief } from "@/lib/types";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isJobBrief(value: unknown): value is JobBrief {
  if (!value || typeof value !== "object") {
    return false;
  }

  const brief = value as Record<string, unknown>;
  return (
    isString(brief.role) && isString(brief.company) && isString(brief.location) && isString(brief.tone) && isString(brief.description)
  );
}

function parseHistory(value: unknown): CoverLetterChatTurn[] | null {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const turns: CoverLetterChatTurn[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const turn = entry as Record<string, unknown>;
    if (turn.role !== "user" && turn.role !== "assistant") {
      return null;
    }

    if (!isString(turn.content)) {
      return null;
    }

    turns.push({ role: turn.role, content: turn.content.slice(0, MAX_HISTORY_CONTENT_CHARS) });
  }

  return turns.slice(-MAX_HISTORY_TURNS);
}

function parseRevisionRequest(body: unknown): CoverLetterRevisionRequest | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const candidate = body as Record<string, unknown>;
  const history = parseHistory(candidate.history);

  if (history === null || !isJobBrief(candidate.brief)) {
    return null;
  }

  if (!isString(candidate.letter) || !candidate.letter.trim() || candidate.letter.length > MAX_LETTER_CHARS) {
    return null;
  }

  if (!isString(candidate.instruction) || !candidate.instruction.trim() || candidate.instruction.length > MAX_INSTRUCTION_CHARS) {
    return null;
  }

  const selection = candidate.selection;
  if (selection !== undefined && selection !== null && !isString(selection)) {
    return null;
  }

  if (isString(selection) && selection.length > MAX_SELECTION_CHARS) {
    return null;
  }

  return {
    brief: candidate.brief,
    letter: candidate.letter,
    selection: isString(selection) ? selection : null,
    instruction: candidate.instruction,
    history
  };
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to chat about this cover letter." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const revisionRequest = parseRevisionRequest(body);
  if (!revisionRequest) {
    return NextResponse.json({ error: "Invalid cover letter chat request." }, { status: 400 });
  }

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = streamCoverLetterRevision(revisionRequest, { signal: request.signal });
  } catch (error) {
    if (error instanceof CoverLetterChatError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    throw error;
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
