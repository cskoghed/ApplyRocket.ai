import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANCHOR_NOT_FOUND_MESSAGE,
  CoverLetterChatError,
  MAX_HISTORY_TURNS,
  PARTIAL_REVISION_MESSAGE,
  UNCHANGED_LETTER_MESSAGE,
  buildRevisionHistory,
  buildRevisionMessages,
  buildRevisionSystemPrompt,
  buildRevisionUserPrompt,
  extractAnthropicDelta,
  extractGeminiDelta,
  extractOpenAiDelta,
  findAnchorSpan,
  getRevisionScope,
  isRevisionMeaningful,
  looksLikeWholeLetter,
  resolveRevisionOutcome,
  streamCoverLetterRevision
} from "./cover-letter-chat";
import { readSseEvents, type SseEvent } from "./sse";
import type { JobBrief } from "./types";

const brief: JobBrief = {
  role: "Product Manager",
  company: "Orbit",
  location: "Remote",
  tone: "confident",
  description: "Own the roadmap for our analytics platform."
};

const letter = "Dear team,\n\nI am excited to apply.\n\nSincerely, Sam";

const anchoredLetter = [
  "Dear hiring team,",
  "",
  "I am excited to apply for the product manager role at Orbit. Over the past six years I have led roadmap work for analytics products and grew activation by 30%.",
  "",
  "In my current role I own discovery, pricing, and launch planning for two product lines. I partner closely with design and engineering every week, and I have shipped three major releases this year.",
  "",
  "I would welcome the chance to talk about how I can help your team.",
  "",
  "Sincerely,",
  "Sam"
].join("\n");

describe("revision scope", () => {
  it("scopes to the selection when a passage is highlighted", () => {
    expect(getRevisionScope({ selection: "I am excited to apply." })).toBe("selection");
  });

  it("falls back to the whole document when there is no usable highlight", () => {
    expect(getRevisionScope({ selection: null })).toBe("document");
    expect(getRevisionScope({ selection: undefined })).toBe("document");
    expect(getRevisionScope({ selection: "   \n " })).toBe("document");
  });
});

describe("revision prompt", () => {
  it("scopes the instruction to the highlighted passage only", () => {
    const prompt = buildRevisionUserPrompt({
      brief,
      letter,
      selection: "I am excited to apply.",
      instruction: "make this more personal"
    });

    expect(prompt).toContain("revise only the highlighted passage");
    expect(prompt).toContain("I am excited to apply.");
    expect(prompt).toContain("make this more personal");
    expect(prompt).toContain(letter);
    expect(prompt).toContain("Product Manager");
    expect(prompt).toContain("ONLY text you may change");
    expect(prompt).not.toContain("Highlighted passage: none");
  });

  it("asks for the text being replaced when nothing is highlighted", () => {
    const prompt = buildRevisionUserPrompt({
      brief,
      letter,
      selection: null,
      instruction: "make the closing stronger"
    });

    expect(prompt).toContain("revise the cover letter");
    expect(prompt).toContain("Highlighted passage: none");
    expect(prompt).toContain("Copy the exact existing text you are replacing into the <find> block");
    expect(prompt).toContain("a single sentence, one paragraph, or the entire letter");
  });

  it("asks for a change only when the instruction calls for one", () => {
    const prompt = buildRevisionUserPrompt({ brief, letter, selection: null, instruction: "Hey" });

    expect(prompt).toContain("Only if the instruction asks for a change");
    expect(prompt).toContain("omit both the <find> and <revision> blocks");
    expect(prompt).toContain("never invent your own tags or put your message inside a tag name");
    expect(prompt).not.toContain("The user wants the whole letter revised");
    expect(buildRevisionSystemPrompt()).toContain("only when the instruction requires the letter to change");
  });
});

describe("anchored document edits", () => {
  const request = { brief, letter: anchoredLetter, selection: null, instruction: "change the goodbye to something more fitting" };

  it("splices a partial revision into the letter and leaves the rest alone", () => {
    const outcome = resolveRevisionOutcome(request, {
      message: "Swapped the sign-off.",
      find: "Sincerely,\nSam",
      revision: "Warm regards,\nSam"
    });

    expect(outcome.scope).toBe("document");
    expect(outcome.message).toBe("Swapped the sign-off.");
    expect(outcome.revision).toBe(anchoredLetter.replace("Sincerely,\nSam", "Warm regards,\nSam"));
    expect(outcome.revision?.startsWith("Dear hiring team,")).toBe(true);
  });

  it("finds an anchor whose whitespace the model reflowed", () => {
    const outcome = resolveRevisionOutcome(request, {
      message: "",
      find: "Sincerely,   Sam",
      revision: "Best regards,\nSam"
    });

    expect(outcome.revision).toBe(anchoredLetter.replace("Sincerely,\nSam", "Best regards,\nSam"));
  });

  it("refuses a revision whose anchor is not in the letter", () => {
    const outcome = resolveRevisionOutcome(request, {
      message: "Done.",
      find: "Yours faithfully,",
      revision: "Warm regards,"
    });

    expect(outcome.revision).toBeNull();
    expect(outcome.message).toBe(ANCHOR_NOT_FOUND_MESSAGE);
  });

  it("refuses an unanchored answer that is too short to be the letter", () => {
    const outcome = resolveRevisionOutcome(request, { message: "Done.", find: "", revision: "Warm regards,\nSam" });

    expect(outcome.revision).toBeNull();
    expect(outcome.message).toBe(PARTIAL_REVISION_MESSAGE);
  });

  it("accepts a full rewrite that carries no anchor", () => {
    const rewritten = anchoredLetter.replace("I am excited", "I am thrilled").replace("Sincerely,", "Warm regards,");
    const outcome = resolveRevisionOutcome({ ...request, instruction: "rewrite the whole letter" }, { message: "", find: "", revision: rewritten });

    expect(outcome.revision).toBe(rewritten);
    expect(outcome.message).toBe("Updated the whole letter.");
  });

  it("drops an anchored revision that changes nothing", () => {
    const outcome = resolveRevisionOutcome(request, {
      message: "No change needed.",
      find: "Sincerely,\nSam",
      revision: "Sincerely,\nSam"
    });

    expect(outcome.revision).toBeNull();
    expect(outcome.message).toBe("No change needed.");
  });

  it("locates anchors exactly and tolerates reflowed whitespace", () => {
    expect(findAnchorSpan(anchoredLetter, "Sincerely,\nSam")).toEqual({
      start: anchoredLetter.indexOf("Sincerely,\nSam"),
      end: anchoredLetter.indexOf("Sincerely,\nSam") + "Sincerely,\nSam".length
    });
    expect(findAnchorSpan(anchoredLetter, "not in the letter")).toBeNull();
    expect(findAnchorSpan(anchoredLetter, "   ")).toBeNull();
  });

  it("matches a passage the client captured without the letter's paragraph break", () => {
    // A highlight crossing a paragraph break reaches the server glued: the editor's text has no
    // newline there, so nothing whitespace-flexible can bridge it.
    const found = findAnchorSpan(anchoredLetter, "Dear hiring team,I am excited to apply for the product manager role at Orbit.");

    expect(found && anchoredLetter.slice(found.start, found.end)).toBe(
      "Dear hiring team,\n\nI am excited to apply for the product manager role at Orbit."
    );
  });

  it("only treats an unanchored revision as the letter when it covers most of it", () => {
    expect(looksLikeWholeLetter(anchoredLetter, anchoredLetter.replace("Sam", "Samantha"))).toBe(true);
    expect(looksLikeWholeLetter(anchoredLetter, "Warm regards,\nSam")).toBe(false);
  });
});

describe("unchanged revisions", () => {
  it("treats whitespace-only rewrites of the letter as no change", () => {
    expect(isRevisionMeaningful({ letter, selection: null }, "Dear team,\n\n\n  I am excited to apply.  \n\nSincerely, Sam\n")).toBe(false);
  });

  it("treats a real edit as a change", () => {
    expect(isRevisionMeaningful({ letter, selection: null }, "Dear team,\n\nI am thrilled to apply.\n\nSincerely, Sam")).toBe(true);
  });

  it("compares a highlighted-passage revision against the selection only", () => {
    expect(isRevisionMeaningful({ letter, selection: "I am excited to apply." }, "I am excited to apply.")).toBe(false);
    expect(isRevisionMeaningful({ letter, selection: "I am excited to apply." }, "I am thrilled to apply.")).toBe(true);
  });

  it("drops a revision that matches the letter and keeps the model's reply", () => {
    const outcome = resolveRevisionOutcome(
      { brief, letter, selection: null, instruction: "Hey" },
      { message: "Hi! What would you like to change?", find: "", revision: letter }
    );

    expect(outcome).toEqual({ scope: "document", message: "Hi! What would you like to change?", revision: null });
  });

  it("explains the letter was left alone when there is no reply text", () => {
    const outcome = resolveRevisionOutcome(
      { brief, letter, selection: null, instruction: "Hey" },
      { message: "", find: "", revision: letter }
    );

    expect(outcome.revision).toBeNull();
    expect(outcome.message).toBe(UNCHANGED_LETTER_MESSAGE);
  });
});

describe("revision history", () => {
  it("keeps only the most recent turns and drops empty ones", () => {
    const history = Array.from({ length: MAX_HISTORY_TURNS + 4 }, (_, index) => ({ role: "user" as const, content: `turn ${index}` }));

    const trimmed = buildRevisionHistory([{ role: "user", content: "   " }, ...history]);

    expect(trimmed).toHaveLength(MAX_HISTORY_TURNS);
    expect(trimmed[0]?.content).toBe("turn 4");
    expect(trimmed[trimmed.length - 1]?.content).toBe(`turn ${MAX_HISTORY_TURNS + 3}`);
  });

  it("appends the assembled prompt as the final user message", () => {
    const messages = buildRevisionMessages({
      brief,
      letter,
      selection: "I am excited to apply.",
      instruction: "tighten it",
      history: [{ role: "assistant", content: "Ready when you are." }]
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "assistant", content: "Ready when you are." });
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("tighten it");
  });
});

describe("provider delta extraction", () => {
  it("reads OpenAI deltas", () => {
    expect(extractOpenAiDelta('{"choices":[{"delta":{"content":"Hi"}}]}')).toBe("Hi");
    expect(extractOpenAiDelta("[DONE]")).toBe("");
    expect(extractOpenAiDelta('{"choices":[{"delta":{}}]}')).toBe("");
    expect(extractOpenAiDelta("not json")).toBe("");
  });

  it("reads Anthropic deltas", () => {
    expect(extractAnthropicDelta('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}')).toBe("Hi");
    expect(extractAnthropicDelta('{"type":"message_start"}')).toBe("");
    expect(extractAnthropicDelta("not json")).toBe("");
  });

  it("reads Gemini deltas", () => {
    expect(extractGeminiDelta('{"candidates":[{"content":{"parts":[{"text":"Hi"},{"text":" there"}]}}]}')).toBe("Hi there");
    expect(extractGeminiDelta('{"candidates":[]}')).toBe("");
    expect(extractGeminiDelta("not json")).toBe("");
  });
});

describe("streaming a revision", () => {
  const previousProvider = process.env.LLM_PROVIDER;
  const previousKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();

    if (previousProvider === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = previousProvider;
    }

    if (previousKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousKey;
    }
  });

  function stubProviderStream(pieces: string[]) {
    const sse = pieces.map((piece) => `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`).join("") + "data: [DONE]\n\n";
    const fetchMock = vi.fn(async () => new Response(new TextEncoder().encode(sse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function collect(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
    const events: SseEvent[] = [];
    for await (const event of readSseEvents(stream)) {
      events.push(event);
    }
    return events;
  }

  it("streams reply deltas and the scoped revision", async () => {
    stubProviderStream(["<reply>Made the ", "opening warmer.</reply>", "<revision>Dear team, I would love to join.</revision>"]);

    const events = await collect(
      streamCoverLetterRevision({ brief, letter, selection: "I am excited to apply.", instruction: "make this more personal" })
    );

    const deltas = events.filter((event) => event.event === "delta").map((event) => (JSON.parse(event.data) as { text: string }).text);
    const revision = events.find((event) => event.event === "revision");
    const done = events.find((event) => event.event === "done");

    expect(deltas.join("")).toBe("Made the opening warmer.");
    expect(revision && (JSON.parse(revision.data) as { scope: string; text: string })).toEqual({
      scope: "selection",
      text: "Dear team, I would love to join."
    });
    expect(done && (JSON.parse(done.data) as { message: string; revision: { text: string } })).toMatchObject({
      message: "Made the opening warmer.",
      revision: { scope: "selection", text: "Dear team, I would love to join." }
    });
  });

  it("reports document scope when nothing is highlighted", async () => {
    stubProviderStream(["<reply>Rewrote it.</reply><revision>Whole new letter.</revision>"]);

    const events = await collect(streamCoverLetterRevision({ brief, letter, selection: null, instruction: "rewrite it" }));
    const revision = events.find((event) => event.event === "revision");

    expect(revision && (JSON.parse(revision.data) as { scope: string }).scope).toBe("document");
  });

  it("emits a null revision for a question-only turn", async () => {
    stubProviderStream(["<reply>Your letter already covers that.</reply>"]);

    const events = await collect(streamCoverLetterRevision({ brief, letter, instruction: "does it mention leadership?" }));
    const done = events.find((event) => event.event === "done");

    expect(done && (JSON.parse(done.data) as { revision: unknown }).revision).toBeNull();
    expect(events.some((event) => event.event === "revision")).toBe(false);
  });

  it("drops a revision that leaves the letter unchanged", async () => {
    stubProviderStream([`<reply>Hi! What would you like to change?</reply><revision>${letter}</revision>`]);

    const events = await collect(streamCoverLetterRevision({ brief, letter, instruction: "Hey" }));
    const done = events.find((event) => event.event === "done");

    expect(events.some((event) => event.event === "revision")).toBe(false);
    expect(done && (JSON.parse(done.data) as { scope: string; message: string; revision: unknown })).toEqual({
      scope: "document",
      message: "Hi! What would you like to change?",
      revision: null
    });
  });

  it("streams the letter with only the anchored passage changed", async () => {
    stubProviderStream([
      "<reply>Swapped the sign-off.</reply>",
      "<find>Sincerely,\nSam</find>",
      "<revision>Warm regards,\nSam</revision>"
    ]);

    const events = await collect(
      streamCoverLetterRevision({ brief, letter: anchoredLetter, instruction: "change the goodbye to something more fitting" })
    );
    const revision = events.find((event) => event.event === "revision");
    const done = events.find((event) => event.event === "done");

    expect(revision && (JSON.parse(revision.data) as { scope: string; text: string })).toEqual({
      scope: "document",
      text: anchoredLetter.replace("Sincerely,\nSam", "Warm regards,\nSam")
    });
    expect(done && (JSON.parse(done.data) as { message: string }).message).toBe("Swapped the sign-off.");
  });

  it("sends the letter, the highlight, and prior turns to the provider", async () => {
    const fetchMock = stubProviderStream(["<reply>Done.</reply>"]);

    await collect(
      streamCoverLetterRevision({
        brief,
        letter,
        selection: "I am excited to apply.",
        instruction: "tighten it",
        history: [{ role: "assistant", content: "Sure." }]
      })
    );

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as { stream: boolean; messages: Array<{ role: string; content: string }> };

    expect(body.stream).toBe(true);
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "assistant", content: "Sure." });
    expect(body.messages[2]?.content).toContain("I am excited to apply.");
    expect(body.messages[2]?.content).toContain("tighten it");
  });

  it("reports provider failures as an error event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));

    const events = await collect(streamCoverLetterRevision({ brief, letter, instruction: "tighten it" }));
    const error = events.find((event) => event.event === "error");

    expect(error && (JSON.parse(error.data) as { error: string }).error).toContain("status 429");
  });

  it("throws before streaming when the provider is not configured", () => {
    delete process.env.OPENAI_API_KEY;

    expect(() => streamCoverLetterRevision({ brief, letter, instruction: "tighten it" })).toThrow(CoverLetterChatError);
    expect(() => streamCoverLetterRevision({ brief, letter, instruction: "tighten it" })).toThrow("OPENAI_API_KEY is not configured.");
  });
});
