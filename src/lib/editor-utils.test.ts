import { describe, expect, it } from "vitest";
import { resolveSelectionOffsets, revisionTextToHtml, rewrittenSelectionOffsets } from "./editor-utils";

describe("revisionTextToHtml", () => {
  it("inserts a single paragraph inline so it does not split the surrounding block", () => {
    expect(revisionTextToHtml("A more personal opening.")).toBe("A more personal opening.");
  });

  it("escapes html in the replacement", () => {
    expect(revisionTextToHtml("Revenue < $1M & growing")).toBe("Revenue &lt; $1M &amp; growing");
  });

  it("keeps single line breaks inside a paragraph", () => {
    expect(revisionTextToHtml("First line\nSecond line")).toBe("First line<br />Second line");
  });

  it("wraps multi-paragraph replacements in paragraphs", () => {
    expect(revisionTextToHtml("First paragraph.\n\nSecond paragraph.")).toBe("<p>First paragraph.</p><p>Second paragraph.</p>");
  });

  it("returns an empty string for blank input", () => {
    expect(revisionTextToHtml("   ")).toBe("");
  });
});

describe("resolveSelectionOffsets", () => {
  const letter = "Dear team,\n\nI am excited to apply.\n\nSincerely, Sam";

  it("uses the captured offsets when the text still matches", () => {
    const start = letter.indexOf("I am excited");
    const selection = { text: "I am excited to apply.", start, end: start + "I am excited to apply.".length };

    expect(resolveSelectionOffsets(letter, selection)).toEqual({ start, end: start + selection.text.length });
  });

  it("re-anchors by text when the offsets drifted", () => {
    const selection = { text: "Sincerely, Sam", start: 3, end: 16 };

    expect(resolveSelectionOffsets(letter, selection)).toEqual({
      start: letter.indexOf("Sincerely, Sam"),
      end: letter.indexOf("Sincerely, Sam") + "Sincerely, Sam".length
    });
  });

  it("trims surrounding whitespace before matching", () => {
    const start = letter.indexOf("I am excited");
    const selection = { text: "  I am excited to apply.  ", start: start - 2, end: start - 2 + "  I am excited to apply.  ".length };

    expect(resolveSelectionOffsets(letter, selection)).toEqual({ start, end: start + "I am excited to apply.".length });
  });

  it("returns null when the passage is gone and must be highlighted again", () => {
    expect(resolveSelectionOffsets(letter, { text: "This sentence was deleted.", start: 0, end: 27 })).toBeNull();
    expect(resolveSelectionOffsets(letter, { text: "   ", start: 0, end: 3 })).toBeNull();
  });
});

describe("rewrittenSelectionOffsets", () => {
  it("covers the text that replaced the selection", () => {
    // "abcde" (5 characters) replaced by "xy": the letter shrinks by three and "xy" starts where "abcde" did.
    expect(rewrittenSelectionOffsets({ start: 2, end: 7 }, 10, 7)).toEqual({ start: 2, end: 4 });
  });

  it("returns null for a replacement that added no text at all", () => {
    expect(rewrittenSelectionOffsets({ start: 4, end: 14 }, 40, 30)).toBeNull();
  });

  it("returns null when the replacement removed text", () => {
    expect(rewrittenSelectionOffsets({ start: 4, end: 14 }, 40, 25)).toBeNull();
  });
});
