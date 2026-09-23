import { describe, expect, it } from "vitest";
import { isCoverLetterChatMessage, isCoverLetterChatMessageList, toChatHistoryTurns } from "./chat-messages";
import type { CoverLetterChatMessage } from "./types";

const userMessage: CoverLetterChatMessage = {
  id: "message-1",
  role: "user",
  content: "make this more personal",
  createdAt: "2026-01-01T00:00:00.000Z",
  selection: "I am excited to apply.",
  parentId: null
};

const assistantMessage: CoverLetterChatMessage = {
  id: "message-2",
  role: "assistant",
  content: "Made the opening warmer.",
  createdAt: "2026-01-01T00:00:01.000Z",
  revision: { scope: "selection", text: "I would love to join the team." },
  parentId: "message-1",
  letter: "<p>Dear team,</p>"
};

describe("cover letter chat message guards", () => {
  it("accepts well-formed messages", () => {
    expect(isCoverLetterChatMessage(userMessage)).toBe(true);
    expect(isCoverLetterChatMessage(assistantMessage)).toBe(true);
    expect(isCoverLetterChatMessageList([userMessage, assistantMessage])).toBe(true);
    expect(isCoverLetterChatMessageList([])).toBe(true);
  });

  it("accepts transcripts stored before branching existed", () => {
    const legacy = { id: "message-3", role: "user" as const, content: "tighten it", createdAt: "2026-01-01T00:00:02.000Z" };

    expect(isCoverLetterChatMessage(legacy)).toBe(true);
    expect(isCoverLetterChatMessage({ ...userMessage, parentId: undefined })).toBe(true);
  });

  it("rejects malformed messages", () => {
    expect(isCoverLetterChatMessage(null)).toBe(false);
    expect(isCoverLetterChatMessage("hello")).toBe(false);
    expect(isCoverLetterChatMessage({ ...userMessage, role: "system" })).toBe(false);
    expect(isCoverLetterChatMessage({ ...userMessage, id: 1 })).toBe(false);
    expect(isCoverLetterChatMessage({ ...assistantMessage, revision: { scope: "paragraph", text: "x" } })).toBe(false);
    expect(isCoverLetterChatMessage({ ...assistantMessage, revision: { scope: "document" } })).toBe(false);
    expect(isCoverLetterChatMessage({ ...userMessage, selection: 5 })).toBe(false);
    expect(isCoverLetterChatMessage({ ...userMessage, parentId: 7 })).toBe(false);
    expect(isCoverLetterChatMessage({ ...userMessage, letter: 7 })).toBe(false);
    expect(isCoverLetterChatMessageList([userMessage, { id: "broken" }])).toBe(false);
    expect(isCoverLetterChatMessageList("nope")).toBe(false);
  });
});

describe("chat message helpers", () => {
  it("maps stored messages to provider turns", () => {
    expect(toChatHistoryTurns([userMessage, assistantMessage])).toEqual([
      { role: "user", content: "make this more personal" },
      { role: "assistant", content: "Made the opening warmer." }
    ]);
  });

  it("defaults to an empty history", () => {
    expect(toChatHistoryTurns(undefined)).toEqual([]);
  });
});
