import { normalizeGeneratedContent } from "./cover-letter";

/**
 * Splits a streamed model response into the channels the chat UI needs:
 *
 *   <reply>Short note for the user.</reply>
 *   <find>The exact existing text that <revision> replaces.</find>
 *   <revision>The rewritten passage or letter.</revision>
 *
 * `<find>` and `<revision>` are optional: a turn that only answers a question omits both, and a
 * response with no `<find>` is understood as a whole-letter replacement. The parser is incremental
 * so it can be fed token chunks of any size, including chunks that split a marker in half, without
 * dropping or duplicating text. Only `<reply>` text is streamed to the user; `<find>` is metadata
 * the server uses to splice the change into the letter.
 */

export const REPLY_OPEN_MARKER = "<reply>";
export const REPLY_CLOSE_MARKER = "</reply>";
export const FIND_OPEN_MARKER = "<find>";
export const FIND_CLOSE_MARKER = "</find>";
export const REVISION_OPEN_MARKER = "<revision>";
export const REVISION_CLOSE_MARKER = "</revision>";

type ParserMode = "preamble" | "reply" | "afterReply" | "find" | "afterFind" | "revision" | "done";

const OPEN_HOLD_BACK =
  Math.max(REPLY_OPEN_MARKER.length, FIND_OPEN_MARKER.length, REVISION_OPEN_MARKER.length) - 1;
const FIND_HOLD_BACK = FIND_CLOSE_MARKER.length - 1;
const REVISION_HOLD_BACK = REVISION_CLOSE_MARKER.length - 1;

export type RevisionStreamResult = {
  message: string;
  /** Exact existing text the revision replaces; empty when the model did not name one. */
  find: string;
  revision: string | null;
};

const BLOCK_MARKER_PATTERN = /<\/?(?:reply|find|revision)>/gi;
const FAKE_TAG_PAIR_PATTERN = /^<([^<>]*)>\s*<\/?([^<>]*)>$/;
const FAKE_TAG_PATTERN = /^<([^<>]*)>$/;

/**
 * The reply text the chat shows the user. Two malformations are repaired here:
 *
 * - Block markers that leaked into the reply (for example an unmatched `</reply>`) are dropped, so
 *   the formatting syntax is never visible.
 * - A model that copies the block format without the block names turns its own sentence into a tag,
 *   "<Changed the closing.></Changed the closing.>", which otherwise shows as stray angle brackets
 *   with the sentence written twice.
 */
export function cleanReplyText(raw: string): string {
  const text = raw.replace(BLOCK_MARKER_PATTERN, " ").trim();

  if (!text.startsWith("<")) {
    return text;
  }

  const paired = FAKE_TAG_PAIR_PATTERN.exec(text);
  if (paired) {
    const opened = (paired[1] ?? "").trim();
    const closed = (paired[2] ?? "").trim();
    return closed.length > opened.length ? closed : opened;
  }

  const single = FAKE_TAG_PATTERN.exec(text);
  return single ? (single[1] ?? "").trim() : text;
}

export class RevisionStreamParser {
  private mode: ParserMode = "preamble";
  private buffer = "";
  private findCaptured = false;
  private readonly replyParts: string[] = [];
  private readonly findParts: string[] = [];
  private readonly revisionParts: string[] = [];

  push(chunk: string): { replyDelta: string } {
    this.buffer += chunk;
    const replyDelta = this.drain();
    if (replyDelta) {
      this.replyParts.push(replyDelta);
    }

    return { replyDelta };
  }

  finish(): RevisionStreamResult {
    const tail = this.drain(true);

    if (tail) {
      if (this.mode === "revision") {
        this.revisionParts.push(tail);
      } else {
        this.replyParts.push(tail);
      }
    }

    const message = cleanReplyText(this.replyParts.join(""));
    const find = normalizeGeneratedContent(this.findParts.join("")).trim();
    const revision = this.mode === "done" || this.revisionParts.length ? normalizeGeneratedContent(this.revisionParts.join("")) : "";

    return {
      message,
      find,
      revision: revision ? revision : null
    };
  }

  private startFind(index: number) {
    this.buffer = this.buffer.slice(index + FIND_OPEN_MARKER.length);
    this.mode = "find";
    this.findCaptured = true;
  }

  private startRevision(index: number) {
    this.buffer = this.buffer.slice(index + REVISION_OPEN_MARKER.length);
    this.mode = "revision";
  }

  /** Picks whichever block marker the model wrote first, so any ordering is understood. */
  private firstMarker(): { index: number; marker: string } | null {
    const markers = [REPLY_OPEN_MARKER, FIND_OPEN_MARKER, REVISION_OPEN_MARKER];
    let found: { index: number; marker: string } | null = null;

    for (const marker of markers) {
      const index = this.buffer.indexOf(marker);
      if (index !== -1 && (!found || index < found.index)) {
        found = { index, marker };
      }
    }

    return found;
  }

  /** The next block marker that ends the current state, so any block ordering is understood. */
  private nextBlock(allowFind: boolean): { index: number; marker: string } | null {
    const findIndex = allowFind ? this.buffer.indexOf(FIND_OPEN_MARKER) : -1;
    const revisionIndex = this.buffer.indexOf(REVISION_OPEN_MARKER);

    if (findIndex !== -1 && (revisionIndex === -1 || findIndex < revisionIndex)) {
      return { index: findIndex, marker: FIND_OPEN_MARKER };
    }

    if (revisionIndex !== -1) {
      return { index: revisionIndex, marker: REVISION_OPEN_MARKER };
    }

    return null;
  }

  private drain(isFinal = false): string {
    let emitted = "";

    while (this.buffer.length) {
      if (this.mode === "done") {
        this.captureTrailingFind();
        this.buffer = "";
        break;
      }

      if (this.mode === "preamble") {
        const found = this.firstMarker();

        if (found) {
          if (found.marker === REPLY_OPEN_MARKER) {
            this.buffer = this.buffer.slice(found.index + REPLY_OPEN_MARKER.length);
            this.mode = "reply";
            continue;
          }

          // Text the model wrote before a block marker still reaches the user as reply text.
          emitted += this.buffer.slice(0, found.index);

          if (found.marker === FIND_OPEN_MARKER) {
            this.startFind(found.index);
          } else {
            this.startRevision(found.index);
          }

          continue;
        }

        if (isFinal) {
          emitted += this.buffer;
          this.buffer = "";
          break;
        }

        // No marker yet: emit everything that cannot be the start of one. A model that ignores
        // the requested format therefore degrades to a plain chat reply.
        if (this.buffer.length > OPEN_HOLD_BACK) {
          const safeLength = this.buffer.length - OPEN_HOLD_BACK;
          emitted += this.buffer.slice(0, safeLength);
          this.buffer = this.buffer.slice(safeLength);
        }

        break;
      }

      if (this.mode === "reply") {
        const closeIndex = this.buffer.indexOf(REPLY_CLOSE_MARKER);
        const found = this.nextBlock(true);

        if (closeIndex !== -1 && (!found || closeIndex <= found.index)) {
          emitted += this.buffer.slice(0, closeIndex);
          this.buffer = this.buffer.slice(closeIndex + REPLY_CLOSE_MARKER.length);
          this.mode = "afterReply";
          continue;
        }

        if (found) {
          emitted += this.buffer.slice(0, found.index);

          if (found.marker === FIND_OPEN_MARKER) {
            this.startFind(found.index);
          } else {
            this.startRevision(found.index);
          }

          continue;
        }

        if (isFinal) {
          emitted += this.buffer;
          this.buffer = "";
          break;
        }

        if (this.buffer.length > OPEN_HOLD_BACK) {
          const safeLength = this.buffer.length - OPEN_HOLD_BACK;
          emitted += this.buffer.slice(0, safeLength);
          this.buffer = this.buffer.slice(safeLength);
        }

        break;
      }

      if (this.mode === "afterReply" || this.mode === "afterFind") {
        const found = this.nextBlock(this.mode === "afterReply");

        if (found) {
          if (found.marker === FIND_OPEN_MARKER) {
            this.startFind(found.index);
          } else {
            this.startRevision(found.index);
          }

          continue;
        }

        if (isFinal) {
          this.buffer = "";
          break;
        }

        if (this.buffer.length > OPEN_HOLD_BACK) {
          this.buffer = this.buffer.slice(this.buffer.length - OPEN_HOLD_BACK);
        }

        break;
      }

      if (this.mode === "find") {
        const closeIndex = this.buffer.indexOf(FIND_CLOSE_MARKER);
        const revisionIndex = this.buffer.indexOf(REVISION_OPEN_MARKER);

        // A `<find>` the model never closed is still usable: the next block ends it.
        if (revisionIndex !== -1 && (closeIndex === -1 || revisionIndex < closeIndex)) {
          this.findParts.push(this.buffer.slice(0, revisionIndex));
          this.startRevision(revisionIndex);
          continue;
        }

        if (closeIndex !== -1) {
          this.findParts.push(this.buffer.slice(0, closeIndex));
          this.buffer = this.buffer.slice(closeIndex + FIND_CLOSE_MARKER.length);
          this.mode = "afterFind";
          continue;
        }

        if (isFinal) {
          this.findParts.push(this.buffer);
          this.buffer = "";
          break;
        }

        if (this.buffer.length > FIND_HOLD_BACK) {
          const safeLength = this.buffer.length - FIND_HOLD_BACK;
          this.findParts.push(this.buffer.slice(0, safeLength));
          this.buffer = this.buffer.slice(safeLength);
        }

        break;
      }

      // mode === "revision"
      const closeIndex = this.buffer.indexOf(REVISION_CLOSE_MARKER);

      if (closeIndex !== -1) {
        this.revisionParts.push(this.buffer.slice(0, closeIndex));
        this.buffer = this.buffer.slice(closeIndex + REVISION_CLOSE_MARKER.length);
        this.mode = "done";
        continue;
      }

      if (isFinal) {
        this.revisionParts.push(this.buffer);
        this.buffer = "";
        break;
      }

      if (this.buffer.length > REVISION_HOLD_BACK) {
        const safeLength = this.buffer.length - REVISION_HOLD_BACK;
        this.revisionParts.push(this.buffer.slice(0, safeLength));
        this.buffer = this.buffer.slice(safeLength);
      }

      break;
    }

    return emitted;
  }

  /**
   * Models occasionally write `<find>` after `<revision>`; honour that ordering too instead of
   * silently treating the change as a whole-letter rewrite.
   */
  private captureTrailingFind() {
    if (this.findCaptured || this.findParts.length) {
      return;
    }

    const openIndex = this.buffer.indexOf(FIND_OPEN_MARKER);
    if (openIndex === -1) {
      return;
    }

    const rest = this.buffer.slice(openIndex + FIND_OPEN_MARKER.length);
    const closeIndex = rest.indexOf(FIND_CLOSE_MARKER);

    this.findParts.push(closeIndex === -1 ? rest : rest.slice(0, closeIndex));
  }
}

export function parseRevisionResponse(raw: string): RevisionStreamResult {
  const parser = new RevisionStreamParser();
  parser.push(raw);
  return parser.finish();
}
