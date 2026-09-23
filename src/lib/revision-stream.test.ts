import { describe, expect, it } from "vitest";
import {
  FIND_CLOSE_MARKER,
  FIND_OPEN_MARKER,
  REVISION_CLOSE_MARKER,
  REVISION_OPEN_MARKER,
  REPLY_CLOSE_MARKER,
  REPLY_OPEN_MARKER,
  cleanReplyText,
  parseRevisionResponse,
  RevisionStreamParser
} from "./revision-stream";

const FORMATTED_REPLY = `${REPLY_OPEN_MARKER}I made the opening warmer.${REPLY_CLOSE_MARKER}\n${REVISION_OPEN_MARKER}Dear team,\n\nI would love to join.${REVISION_CLOSE_MARKER}`;
const FORMATTED_PASSAGE = `${REPLY_OPEN_MARKER}Swapped the sign-off.${REPLY_CLOSE_MARKER}${FIND_OPEN_MARKER}Sincerely,\nSam${FIND_CLOSE_MARKER}${REVISION_OPEN_MARKER}Warm regards,\nSam${REVISION_CLOSE_MARKER}`;

function streamByCharacter(text: string) {
  const parser = new RevisionStreamParser();
  let streamed = "";

  for (const character of text) {
    streamed += parser.push(character).replyDelta;
  }

  return { streamed, result: parser.finish() };
}

describe("revision stream parser", () => {
  it("splits a formatted response into reply text and the revision", () => {
    const parser = new RevisionStreamParser();
    const first = parser.push(FORMATTED_REPLY);
    const result = parser.finish();

    expect(first.replyDelta).toBe("I made the opening warmer.");
    expect(result.message).toBe("I made the opening warmer.");
    expect(result.revision).toBe("Dear team,\n\nI would love to join.");
  });

  it("produces the same result when the response arrives one character at a time", () => {
    const { streamed, result } = streamByCharacter(FORMATTED_REPLY);

    expect(streamed).toBe("I made the opening warmer.");
    expect(result.revision).toBe("Dear team,\n\nI would love to join.");
  });

  it("produces the same result when the response arrives in raw chunks", () => {
    const parser = new RevisionStreamParser();
    const chunks = ["<rep", "ly>Warmer", " opening</rep", "ly><revi", "sion>New", " text</re", "vision>", "trailing noise"];
    let streamed = "";

    for (const chunk of chunks) {
      streamed += parser.push(chunk).replyDelta;
    }

    const result = parser.finish();

    expect(streamed).toBe("Warmer opening");
    expect(result.message).toBe("Warmer opening");
    expect(result.revision).toBe("New text");
  });

  it("returns a null revision when the model only answers a question", () => {
    const result = parseRevisionResponse(`${REPLY_OPEN_MARKER}The letter already mentions your team leadership.${REPLY_CLOSE_MARKER}`);

    expect(result.message).toBe("The letter already mentions your team leadership.");
    expect(result.revision).toBeNull();
  });

  it("treats unformatted output as a plain reply so nothing is lost", () => {
    const result = parseRevisionResponse("Sure, here is my thinking about the opening.");

    expect(result.message).toBe("Sure, here is my thinking about the opening.");
    expect(result.revision).toBeNull();
  });

  it("falls back to reply text when the model skips the reply markers", () => {
    const result = parseRevisionResponse(`Rewrote the opening.\n${REVISION_OPEN_MARKER}New opening.${REVISION_CLOSE_MARKER}`);

    expect(result.message).toBe("Rewrote the opening.");
    expect(result.revision).toBe("New opening.");
  });

  it("strips markdown fences around the revision", () => {
    const result = parseRevisionResponse(`${REPLY_OPEN_MARKER}Done.${REPLY_CLOSE_MARKER}${REVISION_OPEN_MARKER}\`\`\`text\nHello\n\`\`\`${REVISION_CLOSE_MARKER}`);

    expect(result.revision).toBe("Hello");
  });

  it("ignores anything the model writes after the revision block", () => {
    const result = parseRevisionResponse(`${FORMATTED_REPLY}\n\nLet me know if you want more changes.`);

    expect(result.revision).toBe("Dear team,\n\nI would love to join.");
    expect(result.message).toBe("I made the opening warmer.");
  });

  it("keeps an unclosed revision block, which happens when a stream is cut short", () => {
    const parser = new RevisionStreamParser();
    parser.push(`${REPLY_OPEN_MARKER}Trimming.${REPLY_CLOSE_MARKER}${REVISION_OPEN_MARKER}Short and sharp.`);
    const result = parser.finish();

    expect(result.message).toBe("Trimming.");
    expect(result.revision).toBe("Short and sharp.");
  });

  it("handles an empty stream", () => {
    const result = parseRevisionResponse("");

    expect(result).toEqual({ message: "", find: "", revision: null });
  });

  it("separates the replaced passage from its replacement", () => {
    const result = parseRevisionResponse(FORMATTED_PASSAGE);

    expect(result).toEqual({ message: "Swapped the sign-off.", find: "Sincerely,\nSam", revision: "Warm regards,\nSam" });
  });

  it("keeps the anchor intact when chunks split the markers", () => {
    const parser = new RevisionStreamParser();
    const chunks = ["<fin", "d>Sincerely", ",\nSam</fi", "nd><revis", "ion>Warm regards,", "\nSam</re", "vision>"];
    let streamed = "";

    for (const chunk of chunks) {
      streamed += parser.push(chunk).replyDelta;
    }

    const result = parser.finish();

    expect(streamed).toBe("");
    expect(result.find).toBe("Sincerely,\nSam");
    expect(result.revision).toBe("Warm regards,\nSam");
  });

  it("uses everything before the revision as the anchor when the find block is never closed", () => {
    const result = parseRevisionResponse(
      `${FIND_OPEN_MARKER}Sincerely,\nSam${REVISION_OPEN_MARKER}Warm regards,\nSam${REVISION_CLOSE_MARKER}`
    );

    expect(result.find).toBe("Sincerely,\nSam");
    expect(result.revision).toBe("Warm regards,\nSam");
  });

  it("accepts an anchor written after the revision", () => {
    const result = parseRevisionResponse(
      `${REVISION_OPEN_MARKER}Warm regards,\nSam${REVISION_CLOSE_MARKER}\n${FIND_OPEN_MARKER}Sincerely,\nSam${FIND_CLOSE_MARKER}`
    );

    expect(result.find).toBe("Sincerely,\nSam");
    expect(result.revision).toBe("Warm regards,\nSam");
  });

  it("reports no revision when the model only names a passage", () => {
    const result = parseRevisionResponse(`${REPLY_OPEN_MARKER}Found it.${REPLY_CLOSE_MARKER}${FIND_OPEN_MARKER}Sincerely,\nSam${FIND_CLOSE_MARKER}`);

    expect(result.find).toBe("Sincerely,\nSam");
    expect(result.revision).toBeNull();
  });
});

describe("reply text cleanup", () => {
  const reportedReply =
    "<I changed the closing to be more casual and fitting for the role of Fart Smeller while keeping a confident tone.></I changed the closing to be more casual and fitting for the role of Fart Smeller while keeping a confident tone.>";

  it("recovers a reply the model wrapped in a tag of its own making", () => {
    const result = parseRevisionResponse(reportedReply);

    expect(result.message).toBe(
      "I changed the closing to be more casual and fitting for the role of Fart Smeller while keeping a confident tone."
    );
    expect(result.message).not.toContain("<");
    expect(result.revision).toBeNull();
  });

  it("keeps the longer side when the fake tag pair is not an exact repeat", () => {
    expect(cleanReplyText("<Swapped the sign-off></Swapped the sign-off.>")).toBe("Swapped the sign-off.");
  });

  it("unwraps a reply that only has the opening fake tag", () => {
    expect(cleanReplyText("<Changed the sign-off to sound warmer.>")).toBe("Changed the sign-off to sound warmer.");
  });

  it("drops block markers that leaked into the reply", () => {
    const result = parseRevisionResponse(`Tightened the opening.${REPLY_CLOSE_MARKER}`);

    expect(result.message).toBe("Tightened the opening.");
  });

  it("leaves ordinary replies untouched", () => {
    expect(parseRevisionResponse(`${REPLY_OPEN_MARKER}Warm regards reads better for this role.${REPLY_CLOSE_MARKER}`).message).toBe(
      "Warm regards reads better for this role."
    );
    expect(cleanReplyText("Tightened the opening.\n\nTell me if you want more.")).toBe("Tightened the opening.\n\nTell me if you want more.");
    expect(cleanReplyText("Compare a < b when ranking the bullet points.")).toBe("Compare a < b when ranking the bullet points.");
  });
});
