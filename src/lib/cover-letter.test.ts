import { describe, expect, it } from "vitest";
import { CoverLetterGenerationError, buildCoverLetterPrompt, draftTemplatesForBrief, generateCoverLetterDraft, normalizeGeneratedContent } from "./cover-letter";
import { countWords, htmlToPlainText, plainTextToHtml } from "./editor-utils";

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
          extractedText: "Experienced designer with product and UX background."
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

  it("throws when no API key is configured for the selected provider", async () => {
    const previousProvider = process.env.LLM_PROVIDER;
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.LLM_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;

    await expect(
      generateCoverLetterDraft({
        brief: {
          role: "Operations Lead",
          company: "ApplyRocket",
          location: "Remote",
          tone: "confident",
          description: "Scale internal processes without adding friction."
        },
        documents: []
      })
    ).rejects.toThrow(CoverLetterGenerationError);

    process.env.LLM_PROVIDER = previousProvider;
    process.env.OPENAI_API_KEY = previousKey;
  });

  it("throws when an unsupported provider is configured", async () => {
    const previousProvider = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = "unsupported";

    await expect(
      generateCoverLetterDraft({
        brief: {
          role: "Engineer",
          company: "Orbit",
          location: "Remote",
          tone: "direct",
          description: "Build reliable products."
        },
        documents: []
      })
    ).rejects.toThrow("Unsupported LLM_PROVIDER");

    process.env.LLM_PROVIDER = previousProvider;
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

  it("counts words correctly", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("Hello world")).toBe(2);
    expect(countWords("One two three four five")).toBe(5);
    expect(countWords("  Multiple   spaces  ")).toBe(2);
  });
});
