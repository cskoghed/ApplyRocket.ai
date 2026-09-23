import { CoverLetterGenerationError, normalizeGeneratedContent, resolveProviderConnection, type ProviderConnection } from "./cover-letter";
import { RevisionStreamParser, parseRevisionResponse, type RevisionStreamResult } from "./revision-stream";
import { formatSseEvent, readSseEvents } from "./sse";
import type { CoverLetterChatTurn, JobBrief } from "./types";

export type RevisionScope = "selection" | "document";

export type CoverLetterRevisionRequest = {
  brief: JobBrief;
  letter: string;
  selection?: string | null;
  instruction: string;
  history?: CoverLetterChatTurn[];
};

export type CoverLetterRevisionResult = {
  scope: RevisionScope;
  message: string;
  revision: string | null;
};

export const MAX_LETTER_CHARS = 20_000;
export const MAX_SELECTION_CHARS = 8_000;
export const MAX_INSTRUCTION_CHARS = 4_000;
export const MAX_HISTORY_TURNS = 8;
export const MAX_HISTORY_CONTENT_CHARS = 2_000;

export class CoverLetterChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverLetterChatError";
  }
}

function buildToneGuidance(tone: JobBrief["tone"]): string {
  switch (tone) {
    case "formal":
      return "formal and traditional";
    case "warm":
      return "warm and personable";
    case "direct":
      return "concise and action-oriented";
    case "confident":
    default:
      return "confident and ownership-driven";
  }
}

export function getRevisionScope(input: Pick<CoverLetterRevisionRequest, "selection">): RevisionScope {
  return input.selection && input.selection.trim().length > 0 ? "selection" : "document";
}

export function buildRevisionSystemPrompt(): string {
  return [
    "You are a precise cover-letter editing assistant inside a job application writing app.",
    "You chat with the applicant about their existing cover letter and revise it only when they actually ask for a change.",
    "Never invent employers, dates, metrics, or achievements that are not already present in the letter or the job brief.",
    "Make surgical edits: keep the applicant's own wording everywhere the user did not ask for a change.",
    "Always answer with a <reply> block.",
    "Add a <find> block quoting the exact existing letter text and a <revision> block with its replacement only when the instruction requires the letter to change; greetings, questions, thank-yous, and requests for advice get a <reply> block alone and leave the letter untouched.",
    "Never write anything outside those blocks."
  ].join(" ");
}

export function buildRevisionUserPrompt(input: CoverLetterRevisionRequest): string {
  const scope = getRevisionScope(input);
  const lines: string[] = [];

  lines.push(
    scope === "selection"
      ? "Task: chat with the applicant about their cover letter. Only if the instruction asks for a change, revise only the highlighted passage."
      : "Task: chat with the applicant about their cover letter. Only if the instruction asks for a change, revise the cover letter."
  );
  lines.push("");
  lines.push("Job brief:");
  lines.push(`- Role: ${input.brief.role || "Not specified"}`);
  lines.push(`- Company: ${input.brief.company || "Not specified"}`);
  if (input.brief.location) {
    lines.push(`- Location: ${input.brief.location}`);
  }
  lines.push(`- Requested tone: ${buildToneGuidance(input.brief.tone)}`);
  lines.push("");
  lines.push("Job description:");
  lines.push(input.brief.description || "Not provided.");
  lines.push("");
  lines.push("Current cover letter (plain text):");
  lines.push('"""');
  lines.push(input.letter);
  lines.push('"""');
  lines.push("");

  if (scope === "selection") {
    lines.push("Highlighted passage - if the instruction asks for a change, this is the ONLY text you may change. Every other sentence of the letter must stay exactly as it is. Put the revised passage in <revision>, and use <find> only when you are replacing a smaller part of the highlighted passage:");
    lines.push('"""');
    lines.push((input.selection ?? "").trim());
    lines.push('"""');
  } else {
    lines.push("Highlighted passage: none. Copy the exact existing text you are replacing into the <find> block - that may be a single sentence, one paragraph, or the entire letter if every paragraph changes.");
  }

  lines.push("");
  lines.push("User instruction:");
  lines.push(input.instruction);
  lines.push("");
  lines.push("Response format:");
  lines.push("<reply>One or two short sentences telling the user what you changed, or answering their question.</reply>");
  lines.push("<find>Copy the exact text from the current letter that your <revision> replaces. Omit this block when the letter does not change.</find>");
  lines.push("<revision>The replacement text only: plain text, no markdown, no surrounding letter, no commentary.</revision>");
  lines.push("Use those block names exactly as written and never invent your own tags or put your message inside a tag name.");
  lines.push("Write the blocks in that order. Include them only when the instruction makes a real change to the letter. If the user only asked a question, sent a greeting, or the letter already reads the way they want, omit both the <find> and <revision> blocks.");

  return lines.join("\n");
}

export function buildRevisionHistory(history: CoverLetterChatTurn[] | undefined): CoverLetterChatTurn[] {
  return (history ?? [])
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && typeof turn.content === "string" && turn.content.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.trim().slice(0, MAX_HISTORY_CONTENT_CHARS) }));
}

export function buildRevisionMessages(input: CoverLetterRevisionRequest): CoverLetterChatTurn[] {
  return [...buildRevisionHistory(input.history), { role: "user", content: buildRevisionUserPrompt(input) }];
}

export function buildRevisionFallbackMessage(scope: RevisionScope): string {
  return scope === "selection" ? "Updated the highlighted passage." : "Updated the whole letter.";
}

export const UNCHANGED_LETTER_MESSAGE = "The letter already reads that way, so I left it unchanged.";
export const UPDATED_PASSAGE_MESSAGE = "Updated that passage in the letter.";
export const ANCHOR_NOT_FOUND_MESSAGE =
  "I could not find that text in the current letter, so it was left unchanged. Highlight the passage you want replaced and try again.";
export const PARTIAL_REVISION_MESSAGE =
  "That answer covered only part of the letter, so I left your letter as it is. Highlight the passage you want changed, or say that you want the whole letter rewritten.";

/** Normalizes text purely for equality checks, so a "revision" that only differs in whitespace, line endings, or markdown fences is not mistaken for a real edit. */
export function normalizeRevisionText(text: string): string {
  return normalizeGeneratedContent(text).replace(/\s+/g, " ").trim();
}

function isSameText(a: string, b: string): boolean {
  return normalizeRevisionText(a) === normalizeRevisionText(b);
}

/**
 * True only when the proposed revision actually differs from the text it would replace.
 */
export function isRevisionMeaningful(
  input: Pick<CoverLetterRevisionRequest, "letter" | "selection">,
  revision: string
): boolean {
  const source = getRevisionScope(input) === "selection" ? input.selection ?? "" : input.letter;
  return !isSameText(source, revision);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds `anchor` in `source` ignoring whitespace entirely, and maps the match back to `source`'s real
 * offsets. Needed because a highlighted passage captured across a paragraph break reaches the server
 * without the newline the letter's own text has, which no whitespace-flexible pattern can bridge.
 */
function findSpanIgnoringWhitespace(source: string, anchor: string): { start: number; end: number } | null {
  const strippedAnchor = anchor.replace(/\s+/g, "");
  if (!strippedAnchor) {
    return null;
  }

  let strippedSource = "";
  const originalIndexes: number[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (/\s/.test(character)) {
      continue;
    }

    strippedSource += character;
    originalIndexes.push(index);
  }

  const matchIndex = strippedSource.indexOf(strippedAnchor);
  if (matchIndex === -1) {
    return null;
  }

  const lastIndex = matchIndex + strippedAnchor.length - 1;

  return { start: originalIndexes[matchIndex]!, end: originalIndexes[lastIndex]! + 1 };
}

/**
 * Locates the text a revision replaces. Exact substrings match first; the fallbacks tolerate the
 * whitespace and line-break differences that appear when a model copies a passage out of the letter or
 * when a highlight crossed a paragraph break.
 */
export function findAnchorSpan(letter: string, find: string): { start: number; end: number } | null {
  const anchor = find.trim();
  if (!anchor) {
    return null;
  }

  const exactIndex = letter.indexOf(anchor);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + anchor.length };
  }

  const pattern = anchor.split(/\s+/).map(escapeRegExp).join("\\s+");
  const match = new RegExp(pattern).exec(letter);

  return match ? { start: match.index, end: match.index + match[0].length } : findSpanIgnoringWhitespace(letter, anchor);
}

function spliceRange(source: string, span: { start: number; end: number }, replacement: string): string {
  return `${source.slice(0, span.start)}${replacement}${source.slice(span.end)}`;
}

/**
 * Minimum share of the letter a revision without a <find> anchor must cover to be accepted as a
 * whole-letter rewrite. A shorter answer is a partial edit whose anchor went missing, and applying
 * it wholesale would delete the rest of the applicant's letter.
 */
export const WHOLE_LETTER_MIN_SHARE = 0.5;
const WHOLE_LETTER_MIN_LENGTH = 240;

export function looksLikeWholeLetter(letter: string, revision: string): boolean {
  const source = normalizeRevisionText(letter);
  if (source.length < WHOLE_LETTER_MIN_LENGTH) {
    return true;
  }

  return normalizeRevisionText(revision).length >= source.length * WHOLE_LETTER_MIN_SHARE;
}

/**
 * Decides what the client should apply. A revision replaces exactly the text named by its <find>
 * anchor, so a chat instruction like "change the goodbye" rewrites that goodbye instead of the whole
 * letter. Revisions that would not change the letter are dropped, and an unanchored answer too short
 * to be the whole letter is refused rather than applied over the entire draft.
 */
export function resolveRevisionOutcome(
  input: CoverLetterRevisionRequest,
  result: RevisionStreamResult
): CoverLetterRevisionResult {
  const scope = getRevisionScope(input);
  const anchor = result.find.trim();

  if (!result.revision) {
    return { scope, message: result.message || "I could not produce a change for that request.", revision: null };
  }

  if (scope === "selection") {
    const selection = input.selection ?? "";
    const span = anchor ? findAnchorSpan(selection, anchor) : null;
    const revision = span ? spliceRange(selection, span, result.revision) : result.revision;

    if (!isRevisionMeaningful(input, revision)) {
      return { scope, message: result.message || UNCHANGED_LETTER_MESSAGE, revision: null };
    }

    return { scope, message: result.message || buildRevisionFallbackMessage(scope), revision };
  }

  if (anchor) {
    const span = findAnchorSpan(input.letter, anchor);

    if (!span) {
      return { scope, message: ANCHOR_NOT_FOUND_MESSAGE, revision: null };
    }

    const revision = spliceRange(input.letter, span, result.revision);

    if (isSameText(input.letter, revision)) {
      return { scope, message: result.message || UNCHANGED_LETTER_MESSAGE, revision: null };
    }

    return { scope, message: result.message || UPDATED_PASSAGE_MESSAGE, revision };
  }

  if (!looksLikeWholeLetter(input.letter, result.revision)) {
    return { scope, message: PARTIAL_REVISION_MESSAGE, revision: null };
  }

  if (isSameText(input.letter, result.revision)) {
    return { scope, message: result.message || UNCHANGED_LETTER_MESSAGE, revision: null };
  }

  return { scope, message: result.message || buildRevisionFallbackMessage(scope), revision: result.revision };
}

export function extractOpenAiDelta(data: string): string {
  if (!data || data === "[DONE]") {
    return "";
  }

  try {
    const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
    return payload.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

export function extractAnthropicDelta(data: string): string {
  if (!data) {
    return "";
  }

  try {
    const payload = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } };
    if (payload.type === "content_block_delta") {
      return payload.delta?.text ?? "";
    }

    return "";
  } catch {
    return "";
  }
}

export function extractGeminiDelta(data: string): string {
  if (!data) {
    return "";
  }

  try {
    const payload = JSON.parse(data) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  } catch {
    return "";
  }
}

function resolveChatConnection(): ProviderConnection {
  try {
    return resolveProviderConnection();
  } catch (error) {
    if (error instanceof CoverLetterGenerationError) {
      throw new CoverLetterChatError(error.message);
    }

    throw error;
  }
}

function buildRequestFailure(provider: ProviderConnection["provider"], response: Response, payloadSnippet: string): CoverLetterChatError {
  return new CoverLetterChatError(
    `${provider} request failed with status ${response.status}. ${payloadSnippet || "No response details were returned."}`
  );
}

async function readFailureSnippet(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return "";
  }
}

async function* streamOpenAi(
  connection: ProviderConnection,
  system: string,
  messages: CoverLetterChatTurn[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: connection.model,
      temperature: 0.55,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages]
    }),
    signal
  });

  if (!response.ok || !response.body) {
    throw buildRequestFailure("openai", response, await readFailureSnippet(response));
  }

  for await (const event of readSseEvents(response.body)) {
    const delta = extractOpenAiDelta(event.data);
    if (delta) {
      yield delta;
    }
  }
}

async function* streamAnthropic(
  connection: ProviderConnection,
  system: string,
  messages: CoverLetterChatTurn[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": connection.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: connection.model,
      max_tokens: 1_600,
      temperature: 0.55,
      stream: true,
      system,
      messages
    }),
    signal
  });

  if (!response.ok || !response.body) {
    throw buildRequestFailure("anthropic", response, await readFailureSnippet(response));
  }

  for await (const event of readSseEvents(response.body)) {
    const delta = extractAnthropicDelta(event.data);
    if (delta) {
      yield delta;
    }
  }
}

async function* streamGemini(
  connection: ProviderConnection,
  system: string,
  messages: CoverLetterChatTurn[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(connection.model)}:streamGenerateContent?alt=sse&key=${connection.apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: system }]
        },
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }]
        })),
        generationConfig: {
          temperature: 0.55
        }
      }),
      signal
    }
  );

  if (!response.ok || !response.body) {
    throw buildRequestFailure("gemini", response, await readFailureSnippet(response));
  }

  for await (const event of readSseEvents(response.body)) {
    const delta = extractGeminiDelta(event.data);
    if (delta) {
      yield delta;
    }
  }
}

function streamProviderDeltas(
  connection: ProviderConnection,
  system: string,
  messages: CoverLetterChatTurn[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  switch (connection.provider) {
    case "openai":
      return streamOpenAi(connection, system, messages, signal);
    case "anthropic":
      return streamAnthropic(connection, system, messages, signal);
    case "gemini":
      return streamGemini(connection, system, messages, signal);
  }
}

/**
 * Streams a cover-letter revision as SSE: `delta` events carry the live chat reply, `revision`
 * carries the text the client should apply (for document scope that is the full updated letter,
 * with an anchored change already spliced in), and `done` carries the authoritative final state.
 *
 * The provider and API key are resolved before the stream is created so configuration problems
 * surface as a normal JSON error response instead of a half-open stream.
 */
export function streamCoverLetterRevision(
  input: CoverLetterRevisionRequest,
  options: { signal?: AbortSignal } = {}
): ReadableStream<Uint8Array> {
  const connection = resolveChatConnection();
  const system = buildRevisionSystemPrompt();
  const messages = buildRevisionMessages(input);
  const encoder = new TextEncoder();
  const parser = new RevisionStreamParser();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(formatSseEvent(event, data)));
        } catch {
          // The client disconnected; there is no one left to notify.
        }
      };

      try {
        for await (const delta of streamProviderDeltas(connection, system, messages, options.signal)) {
          const { replyDelta } = parser.push(delta);
          if (replyDelta) {
            send("delta", { text: replyDelta });
          }
        }

        const result = parser.finish();
        const outcome = resolveRevisionOutcome(input, result);

        if (outcome.revision) {
          send("revision", { scope: outcome.scope, text: outcome.revision });
        }

        send("done", {
          scope: outcome.scope,
          message: outcome.message,
          revision: outcome.revision ? { scope: outcome.scope, text: outcome.revision } : null
        });
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "The cover letter revision stream failed.";
        send("error", { error: message });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the consumer.
        }
      }
    }
  });
}

/**
 * Non-streaming convenience wrapper used by tests and any caller that does not need SSE.
 */
export async function requestCoverLetterRevision(input: CoverLetterRevisionRequest): Promise<CoverLetterRevisionResult> {
  const connection = resolveChatConnection();
  const system = buildRevisionSystemPrompt();
  const messages = buildRevisionMessages(input);
  let raw = "";

  for await (const delta of streamProviderDeltas(connection, system, messages)) {
    raw += delta;
  }

  return resolveRevisionOutcome(input, parseRevisionResponse(raw));
}
