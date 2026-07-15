import type { CoverLetterDraft, CoverLetterGenerationInput } from "./types";
import { buildDocumentContextSummary, summarizeDocuments } from "./file-utils";

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

function buildFallbackDraft(input: CoverLetterGenerationInput): CoverLetterDraft {
  const documentNames = input.documents.map((document) => document.name).join(", ") || "the uploaded materials";
  const greetingTarget = input.brief.company ? `${input.brief.company} team` : "hiring team";
  const openingLine = `I am excited to apply for the ${input.brief.role} position${input.brief.company ? ` at ${input.brief.company}` : ""}. My background and the materials I shared (${documentNames}) reflect a strong fit for the role, with experience that translates into immediate value for your team.`;
  const contextLine = `This opportunity stands out because ${input.brief.description.trim().slice(0, 240) || "it matches the kind of work where I can contribute with focus and ownership"}. I bring a practical approach to solving problems, collaborating across teams, and delivering clear results.`;

  return {
    title: `${input.brief.role} cover letter`,
    content: [
      `Dear ${greetingTarget},`,
      "",
      openingLine,
      "",
      contextLine,
      "",
      "I would welcome the chance to discuss how my background can support your goals and help move the team forward.",
      "",
      "Sincerely,",
      "Your Name"
    ].join("\n"),
    summary: `Drafted for ${input.brief.role}${input.brief.company ? ` at ${input.brief.company}` : ""}.`,
    bullets: [
      `Tailored to the ${input.brief.role} role`,
      `Aligned to a ${input.brief.tone} tone`,
      `Built from ${input.documents.length} uploaded document${input.documents.length === 1 ? "" : "s"}`
    ],
    provider: "template",
    generatedAt: new Date().toISOString()
  };
}

async function tryOpenAI(input: CoverLetterGenerationInput): Promise<CoverLetterDraft | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
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
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return null;
  }

  const normalizedContent = normalizeGeneratedContent(content);

  return {
    title: `${input.brief.role} cover letter`,
    content: normalizedContent,
    summary: `Generated for ${input.brief.role}${input.brief.company ? ` at ${input.brief.company}` : ""} using OpenAI.`,
    bullets: [
      `Tailored to the ${input.brief.role} role`,
      `Aligned to a ${input.brief.tone} tone`,
      `Informed by ${input.documents.length} uploaded document${input.documents.length === 1 ? "" : "s"}`
    ],
    provider: "openai",
    generatedAt: new Date().toISOString()
  };
}

export async function generateCoverLetterDraft(input: CoverLetterGenerationInput): Promise<CoverLetterDraft> {
  try {
    const openAiDraft = await tryOpenAI(input);
    if (openAiDraft) {
      return openAiDraft;
    }
  } catch {
    // Use the local fallback when the API is unavailable.
  }

  return buildFallbackDraft(input);
}
