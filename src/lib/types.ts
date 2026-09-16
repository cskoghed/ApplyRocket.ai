export type DocumentKind = "cv" | "attachment";

export type UploadedDocument = {
  id: string;
  name: string;
  kind: DocumentKind;
  type: string;
  size: number;
  extractedText: string;
};

export type JobBrief = {
  role: string;
  company: string;
  location: string;
  tone: "formal" | "confident" | "warm" | "direct";
  description: string;
};

export type CoverLetterGenerationInput = {
  brief: JobBrief;
  documents: Array<Pick<UploadedDocument, "name" | "kind" | "type" | "size" | "extractedText">>;
};

export type CoverLetterDraft = {
  title: string;
  content: string;
  summary: string;
  bullets: string[];
  provider: "template" | "openai" | "anthropic" | "gemini";
  generatedAt: string;
};

export type WorkspaceSnapshot = {
  brief: JobBrief;
  draft: CoverLetterDraft;
  documents: UploadedDocument[];
  editedContent: string;
};

export type WorkspaceRecord = WorkspaceSnapshot & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredWorkspaceRecord = WorkspaceRecord & {
  ownerId?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

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
  ownerId?: string;
};

export type NewDocumentInput = Pick<DocumentRecord, "name" | "kind" | "type" | "size" | "extractedText">;
