import type { CoverLetterChatMessage } from "./types";

/**
 * Shape guards and history helpers for the persisted chat transcript. Kept free of provider
 * and persistence code so both API routes can validate payloads the same way. Tree structure
 * (branches) lives in `chat-branches.ts`.
 */

export const MAX_STORED_CHAT_MESSAGES = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isCoverLetterChatMessage(value: unknown): value is CoverLetterChatMessage {
  if (!isRecord(value)) {
    return false;
  }

  const { id, role, content, createdAt } = value;
  if (typeof id !== "string" || typeof content !== "string" || typeof createdAt !== "string") {
    return false;
  }

  if (role !== "user" && role !== "assistant") {
    return false;
  }

  if (value.selection !== undefined && typeof value.selection !== "string") {
    return false;
  }

  if (value.parentId !== undefined && value.parentId !== null && typeof value.parentId !== "string") {
    return false;
  }

  if (value.letter !== undefined && typeof value.letter !== "string") {
    return false;
  }

  if (value.revision !== undefined) {
    const revision = value.revision;
    if (!isRecord(revision)) {
      return false;
    }

    if (revision.scope !== "selection" && revision.scope !== "document") {
      return false;
    }

    if (typeof revision.text !== "string") {
      return false;
    }
  }

  return true;
}

export function isCoverLetterChatMessageList(value: unknown): value is CoverLetterChatMessage[] {
  return Array.isArray(value) && value.every((message) => isCoverLetterChatMessage(message));
}

export function toChatHistoryTurns(
  messages: CoverLetterChatMessage[] | undefined
): Array<{ role: CoverLetterChatMessage["role"]; content: string }> {
  return (messages ?? []).map((message) => ({ role: message.role, content: message.content }));
}
