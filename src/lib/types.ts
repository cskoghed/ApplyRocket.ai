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

export type CoverLetterChatRole = "user" | "assistant";

export type CoverLetterChatRevision = {
  scope: "selection" | "document";
  text: string;
};

export type CoverLetterChatMessage = {
  id: string;
  role: CoverLetterChatRole;
  content: string;
  createdAt: string;
  /** Highlighted passage a user turn was scoped to. */
  selection?: string;
  /** Set on assistant turns that changed the letter. */
  revision?: CoverLetterChatRevision;
  /**
   * Conversation structure: the message this turn follows, or null when it starts the conversation.
   * Editing a message creates an additional message with the same parentId, which makes the two
   * sibling messages the branches of that point in the conversation.
   */
  parentId: string | null;
  /**
   * Cover letter (rich text HTML) as it stood for this turn: for a user turn the state its instruction
   * was applied to, and for an assistant turn the state after the change. Absent for transcripts saved
   * before branching existed.
   */
  letter?: string;
};

export type CoverLetterChatTurn = {
  role: CoverLetterChatRole;
  content: string;
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
  chatMessages?: CoverLetterChatMessage[];
  /** The branch of the chat transcript the user is currently looking at. */
  chatActiveLeafId?: string | null;
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
