export function plainTextToHtml(text: string): string {
  const paragraphs = text
    .split(/\n\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return "<p></p>";
  }

  return paragraphs
    .map((paragraph) => {
      const escaped = paragraph
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br />");
      return `<p>${escaped}</p>`;
    })
    .join("");
}

export function htmlToPlainText(html: string): string {
  if (!html.trim()) {
    return "";
  }

  const normalized = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "");

  return normalized
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function safeHtmlFromText(text: string): string {
  return plainTextToHtml(text).replace(/\n/g, "");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Converts revision text into HTML that can be dropped into the middle of an existing paragraph.
 *
 * A single-paragraph replacement is inserted inline so it does not split the surrounding block;
 * multi-paragraph replacements become real paragraphs.
 */
export function revisionTextToHtml(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }

  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);

  if (paragraphs.length <= 1) {
    return escapeHtml(paragraphs[0] ?? "").replace(/\n/g, "<br />");
  }

  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`).join("");
}

export type EditorSelection = {
  text: string;
  start: number;
  end: number;
};

/**
 * Offsets of the text that replaced a selection, so a rewritten passage can stay highlighted.
 *
 * Paragraph and line-break markup adds nothing to the editor's plain text, so the range comes from how
 * many characters the replacement really added rather than from the replacement's own length.
 */
export function rewrittenSelectionOffsets(
  resolved: { start: number; end: number },
  lengthBefore: number,
  lengthAfter: number
): { start: number; end: number } | null {
  const inserted = lengthAfter - (lengthBefore - (resolved.end - resolved.start));

  return inserted > 0 ? { start: resolved.start, end: resolved.start + inserted } : null;
}

/**
 * Re-anchors a captured highlight against the editor's current text.
 *
 * Offsets are preferred because they survive duplicate sentences, but any edit made after the
 * highlight was captured can invalidate them, so the captured text is used as a fallback. Returns
 * null when the passage no longer exists and the user has to highlight it again.
 */
export function resolveSelectionOffsets(
  currentText: string,
  captured: EditorSelection
): { start: number; end: number } | null {
  const { text, start } = captured;
  const target = text.trim();

  if (!target) {
    return null;
  }

  const leadingTrim = text.length - text.trimStart().length;
  const normalizedStart = Math.max(0, start + leadingTrim);
  const normalizedEnd = normalizedStart + target.length;

  if (
    normalizedStart >= 0 &&
    normalizedEnd <= currentText.length &&
    normalizedStart < normalizedEnd &&
    currentText.slice(normalizedStart, normalizedEnd) === target
  ) {
    return { start: normalizedStart, end: normalizedEnd };
  }

  const fallbackIndex = currentText.indexOf(target);
  if (fallbackIndex === -1) {
    return null;
  }

  return { start: fallbackIndex, end: fallbackIndex + target.length };
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
