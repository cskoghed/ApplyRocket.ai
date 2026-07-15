import { describe, expect, it } from "vitest";
import { buildCoverLetterPrompt, draftTemplatesForBrief, generateCoverLetterDraft, normalizeGeneratedContent } from "./cover-letter";
import { htmlToPlainText, plainTextToHtml } from "./editor-utils";

describe("cover letter helpers", () => {
  it("builds a prompt with structured document context", () => {
    const prompt = buildCoverLetterPrompt({
      brief: {
        role: "Designer",
        company: "Orbit",
        location: "London",
        tone: "warm",
        description: "Bring clarity to complex workflows."
      },
      documents: [
        {
          name: "cv.txt",
          kind: "cv",
          type: "text/plain",
          size: 42,
          preview: "Experienced designer with product and UX background."
        }
      ]
    });

    expect(prompt).toContain("Designer");
    expect(prompt).toContain("Structured document summary");
    expect(prompt).toContain("Experienced designer");
  });

  it("normalizes fenced content", () => {
    expect(normalizeGeneratedContent("```text\nHello\n```\n")).toBe("Hello");
  });

  it("falls back to a local draft when no API key is configured", async () => {
    const previousKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const draft = await generateCoverLetterDraft({
      brief: {
        role: "Operations Lead",
        company: "ApplyRocket",
        location: "Remote",
        tone: "confident",
        description: "Scale internal processes without adding friction."
      },
      documents: []
    });

    process.env.OPENAI_API_KEY = previousKey;

    expect(draft.provider).toBe("template");
    expect(draft.content).toContain("Operations Lead");
  });

  it("creates editable templates for the selected role and company", () => {
    const templates = draftTemplatesForBrief("Designer", "Orbit");
    expect(templates).toHaveLength(3);
    expect(templates[0].content).toContain("Designer");
    expect(templates[0].content).toContain("Orbit");
  });

  it("round-trips plain text and html for the editor", () => {
    const html = plainTextToHtml("Hello\n\nWorld");
    expect(htmlToPlainText(html)).toBe("Hello\n\nWorld");
  });
});
