import type { CoverLetterDraft, CoverLetterGenerationInput } from "./types";
import { buildDocumentContextSummary, summarizeDocuments } from "./file-utils";

type LlmProvider = Exclude<CoverLetterDraft["provider"], "template">;

function buildToneGuidance(tone: CoverLetterGenerationInput["brief"]["tone"]): string {
  switch (tone) {
    case "formal":
      return "Use a polished, traditional tone.";
    case "warm":
      return "Use a personable tone with clear enthusiasm.";
    case "direct":
      return "Keep the language concise, sharp, and action-oriented.";
    case "confident":
    default:
      return "Use confident language that signals ownership and impact.";
  }
}

export function buildCoverLetterPrompt(input: CoverLetterGenerationInput): string {
  const documentSummary = summarizeDocuments(input.documents);
  const structuredContext = buildDocumentContextSummary(input.documents);

  return [
    "You are an expert job application assistant.",
    `Write a cover letter for the role '${input.brief.role}' at '${input.brief.company}'.`,
    input.brief.location ? `The role is based in ${input.brief.location}.` : "",
    buildToneGuidance(input.brief.tone),
    "Write a letter that sounds human, specific, and tailored to the candidate's background.",
    "Focus on strengths, relevant experience, and a crisp call to action.",
    "Return only the cover letter body, no markdown fences or commentary.",
    "",
    "Candidate materials:",
    documentSummary || "No supporting documents were provided.",
    "",
    "Structured document summary:",
    structuredContext,
    "",
    "Job context:",
    input.brief.description
  ]
    .filter(Boolean)
    .join("\n");
}

export function normalizeGeneratedContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

export function draftTemplatesForBrief(role: string, company: string): Array<{ id: string; label: string; content: string }> {
  const companyClause = company ? ` at ${company}` : "";

  return [
    {
      id: "opening",
      label: "Opening",
      content: `Dear hiring team,\n\nI am excited to apply for the ${role} position${companyClause}. My background has prepared me to contribute quickly and thoughtfully from day one.\n\n`
    },
    {
      id: "evidence",
      label: "Impact paragraph",
      content: `One of my strengths is turning ambiguity into action. In previous roles, I have built momentum across cross-functional teams, aligned stakeholders, and delivered measurable outcomes.\n\n`
    },
    {
      id: "closing",
      label: "Closing",
      content: `I would welcome the opportunity to discuss how I can help your team. Thank you for your time and consideration.\n\nSincerely,\nYour Name`
    }
  ];
}

export class CoverLetterGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverLetterGenerationError";
  }
}

function getConfiguredProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER || "openai").trim().toLowerCase();
  if (provider === "openai" || provider === "anthropic" || provider === "gemini") {
    return provider;
  }

  if (provider === "google" || provider === "google-gemini") {
    return "gemini";
  }

  throw new CoverLetterGenerationError("Unsupported LLM_PROVIDER. Use 'openai', 'anthropic', or 'gemini'.");
}

function buildDraft(input: CoverLetterGenerationInput, content: string, provider: LlmProvider): CoverLetterDraft {
  return {
    title: `${input.brief.role} cover letter`,
    content,
    summary: `Generated for ${input.brief.role}${input.brief.company ? ` at ${input.brief.company}` : ""} using ${provider}.`,
    bullets: [
      `Tailored to the ${input.brief.role} role`,
      `Aligned to a ${input.brief.tone} tone`,
      `Informed by ${input.documents.length} uploaded document${input.documents.length === 1 ? "" : "s"}`
    ],
    provider,
    generatedAt: new Date().toISOString()
  };
}

function buildRequestError(provider: LlmProvider, response: Response, payloadSnippet: string): CoverLetterGenerationError {
  return new CoverLetterGenerationError(
    `${provider} request failed with status ${response.status}. ${payloadSnippet || "No response details were returned."}`
  );
}

async function tryOpenAI(input: CoverLetterGenerationInput): Promise<CoverLetterDraft> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new CoverLetterGenerationError("OPENAI_API_KEY is not configured.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const prompt = buildCoverLetterPrompt(input);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.65,
      messages: [
        {
          role: "system",
          content: "You write polished, concise cover letters for job applications."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const payloadSnippet = (await response.text()).slice(0, 400);
    throw buildRequestError("openai", response, payloadSnippet);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new CoverLetterGenerationError("OpenAI returned an empty draft.");
  }

  return buildDraft(input, normalizeGeneratedContent(content), "openai");
}

async function tryAnthropic(input: CoverLetterGenerationInput): Promise<CoverLetterDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new CoverLetterGenerationError("ANTHROPIC_API_KEY is not configured.");
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
  const prompt = buildCoverLetterPrompt(input);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      temperature: 0.65,
      system: "You write polished, concise cover letters for job applications.",
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    const payloadSnippet = (await response.text()).slice(0, 400);
    throw buildRequestError("anthropic", response, payloadSnippet);
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const content = payload.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text?.trim() ?? "")
    .join("\n")
    .trim();
  if (!content) {
    throw new CoverLetterGenerationError("Anthropic returned an empty draft.");
  }

  return buildDraft(input, normalizeGeneratedContent(content), "anthropic");
}

async function tryGemini(input: CoverLetterGenerationInput): Promise<CoverLetterDraft> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new CoverLetterGenerationError("GEMINI_API_KEY (or GOOGLE_API_KEY) is not configured.");
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const prompt = buildCoverLetterPrompt(input);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: "You write polished, concise cover letters for job applications." }]
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.65
      }
    })
  });

  if (!response.ok) {
    const payloadSnippet = (await response.text()).slice(0, 400);
    throw buildRequestError("gemini", response, payloadSnippet);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text?.trim() ?? "")
    .join("\n")
    .trim();

  if (!content) {
    throw new CoverLetterGenerationError("Gemini returned an empty draft.");
  }

  return buildDraft(input, normalizeGeneratedContent(content), "gemini");
}

export async function generateCoverLetterDraft(input: CoverLetterGenerationInput): Promise<CoverLetterDraft> {
  const provider = getConfiguredProvider();
  switch (provider) {
    case "openai":
      return tryOpenAI(input);
    case "anthropic":
      return tryAnthropic(input);
    case "gemini":
      return tryGemini(input);
  }
}
