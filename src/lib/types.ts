export type DocumentKind = "cv" | "attachment";

/**
 * A document persisted in a user's document library, bound to their account.
 * Identified by `id` so applications can reference it without duplicating it.
 */
export type DocumentRecord = {
  id: string;
  name: string;
  kind: DocumentKind;
  type: string;
  size: number;
  extractedText: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredDocumentRecord = DocumentRecord & {
  ownerId: string;
};

export type NewDocumentInput = Pick<DocumentRecord, "name" | "kind" | "type" | "size" | "extractedText">;

/** A document as extracted client-side, before it has been saved to the library. */
export type DocumentDraft = NewDocumentInput;

export type JobBrief = {
  role: string;
  company: string;
  location: string;
  tone: "formal" | "confident" | "warm" | "direct";
  description: string;
};

export type CoverLetterGenerationInput = {
  brief: JobBrief;
  documents: Array<Pick<DocumentRecord, "name" | "kind" | "type" | "size" | "extractedText">>;
};

export type CoverLetterDraft = {
  title: string;
  content: string;
  summary: string;
  bullets: string[];
  provider: "template" | "openai" | "anthropic" | "gemini";
  generatedAt: string;
};

/**
 * An application's saved state. `documentIds` references documents in the
 * user's document library rather than embedding full document payloads, so a
 * single uploaded document can be attached to multiple applications.
 */
export type ApplicationSnapshot = {
  brief: JobBrief;
  draft: CoverLetterDraft;
  documentIds: string[];
  editedContent: string;
};

export type ApplicationRecord = ApplicationSnapshot & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredApplicationRecord = ApplicationRecord & {
  ownerId?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};
