import { createTextPreview, extractUploadedText } from "./document-extraction";
import type { DocumentKind, UploadedDocument } from "./types";

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

export async function createDocumentRecord(file: File, kind: DocumentKind): Promise<UploadedDocument> {
  const extractedText = await extractUploadedText(file);
  const preview = extractedText ? createTextPreview(extractedText) : await readFilePreview(file);

  return {
    id: crypto.randomUUID(),
    name: file.name,
    kind,
    type: file.type || "application/octet-stream",
    size: file.size,
    preview,
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

export function summarizeDocuments(documents: Array<Pick<UploadedDocument, "name" | "kind" | "preview" | "extractedText">>): string {
  return documents
    .map((document, index) => {
      const preview = (document.extractedText || document.preview).trim();
      const previewSuffix = preview ? `\nExcerpt:\n${preview.slice(0, 400)}` : "";
      return `${index + 1}. ${document.kind.toUpperCase()} - ${document.name}${previewSuffix}`;
    })
    .join("\n\n");
}

export function buildDocumentContextSummary(documents: Array<Pick<UploadedDocument, "name" | "kind" | "preview" | "type" | "extractedText">>): string {
  if (!documents.length) {
    return "No supporting documents were uploaded.";
  }

  return documents
    .map((document, index) => {
      const excerpt = (document.extractedText || document.preview).trim().replace(/\s+/g, " ").slice(0, 240);
      return [
        `${index + 1}. ${document.kind.toUpperCase()}: ${document.name}`,
        `Type: ${document.type}`,
        excerpt ? `Excerpt: ${excerpt}` : "Excerpt: none available"
      ].join("\n");
    })
    .join("\n\n");
}
