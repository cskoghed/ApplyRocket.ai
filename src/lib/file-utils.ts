import { extractUploadedText } from "./document-extraction";
import type { DocumentDraft, DocumentKind } from "./types";

const MAX_PREVIEW_CHARS = 2_000;
const TEXT_FILE_PATTERN = /\.(txt|md|markdown|json|csv|rtf|html|xml)$/i;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_FILE_PATTERN = /\.(pdf|docx?|txt|md|markdown|rtf|html|xml|json|csv|odt|pages)$/i;

export function isAllowedUpload(file: File): boolean {
  return ACCEPTED_FILE_PATTERN.test(file.name) || file.type.startsWith("text/") || file.type === "application/pdf";
}

export function getUploadLimitMessage(): string {
  return "Accepted files: PDF, DOC, DOCX, TXT, MD, HTML, XML, JSON, CSV, RTF, ODT, and PAGES up to 10 MB each.";
}

export function validateUpload(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `${file.name} is larger than 10 MB.`;
  }

  if (!isAllowedUpload(file)) {
    return `${file.name} is not a supported file type.`;
  }

  return null;
}

export function detectDocumentKind(file: File, isFirstDocument: boolean): DocumentKind {
  if (isFirstDocument) {
    return "cv";
  }

  if (/(cv|resume|curriculum|profile)/i.test(file.name)) {
    return "cv";
  }

  return "attachment";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) {
    return `${kibibytes.toFixed(1)} KB`;
  }

  return `${(kibibytes / 1024).toFixed(1)} MB`;
}

export function createSecureDocumentId(): string {
  const runtimeCrypto = globalThis.crypto;
  if (typeof runtimeCrypto?.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  if (typeof runtimeCrypto?.getRandomValues === "function") {
    const bytes = runtimeCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error("Secure random ID generation is unavailable in this browser.");
}

export async function createDocumentDraft(file: File, kind: DocumentKind): Promise<DocumentDraft> {
  const extractedText = await extractUploadedText(file);

  return {
    name: file.name,
    kind,
    type: file.type || "application/octet-stream",
    size: file.size,
    extractedText
  };
}

export async function readFilePreview(file: File): Promise<string> {
  if (!TEXT_FILE_PATTERN.test(file.name) && !file.type.startsWith("text/")) {
    return "";
  }

  try {
    const text = await file.text();
    return text.slice(0, MAX_PREVIEW_CHARS);
  } catch {
    return "";
  }
}

type LegacyDocumentSummaryInput = { name: string; kind: DocumentKind; extractedText: string; preview?: string };

export function summarizeDocuments(documents: LegacyDocumentSummaryInput[]): string {
  return documents
    .map((document, index) => {
      const preview = (document.extractedText || ("preview" in document ? document.preview : "") || "").trim();
      const previewSuffix = preview ? `\nExcerpt:\n${preview.slice(0, 400)}` : "";
      return `${index + 1}. ${document.kind.toUpperCase()} - ${document.name}${previewSuffix}`;
    })
    .join("\n\n");
}

export function buildDocumentContextSummary(documents: Array<{ name: string; kind: DocumentKind; type: string; extractedText: string; preview?: string }>): string {
  if (!documents.length) {
    return "No supporting documents were uploaded.";
  }

  return documents
    .map((document, index) => {
      const excerpt = (document.extractedText || ("preview" in document ? document.preview : "") || "").trim().replace(/\s+/g, " ").slice(0, 240);
      return [
        `${index + 1}. ${document.kind.toUpperCase()}: ${document.name}`,
        `Type: ${document.type}`,
        excerpt ? `Excerpt: ${excerpt}` : "Excerpt: none available"
      ].join("\n");
    })
    .join("\n\n");
}
