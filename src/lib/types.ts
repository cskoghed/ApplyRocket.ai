export type DocumentKind = "cv" | "attachment";

export type UploadedDocument = {
  id: string;
  name: string;
  kind: DocumentKind;
  type: string;
  size: number;
  preview: string;
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
  documents: Array<Pick<UploadedDocument, "name" | "kind" | "type" | "size" | "preview" | "extractedText">>;
};

export type CoverLetterDraft = {
  title: string;
  content: string;
  summary: string;
  bullets: string[];
  provider: "template" | "openai";
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
