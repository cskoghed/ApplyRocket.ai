"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { plainTextToHtml, resolveSelectionOffsets, revisionTextToHtml, rewrittenSelectionOffsets, type EditorSelection } from "@/lib/editor-utils";

export type { EditorSelection };

export type RichTextEditorApi = {
  getText: () => string;
  getHtml: () => string;
  getSelection: () => EditorSelection | null;
  /**
   * Replaces the highlighted passage and returns the rewritten passage so it can stay highlighted.
   * Null means the passage could not be found any more and nothing was changed.
   */
  replaceSelection: (selection: EditorSelection, replacement: string) => EditorSelection | null;
  replaceDocument: (replacement: string) => void;
};

type RichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
  apiRef?: MutableRefObject<RichTextEditorApi | null>;
  onSelectionChange?: (selection: EditorSelection | null) => void;
  /** Captured highlight to keep visible in the letter while the user works elsewhere, such as the chat box. */
  highlight?: EditorSelection | null;
};

/** Name of the CSS Custom Highlight holding the captured passage. */
export const CAPTURED_HIGHLIGHT_NAME = "captured-passage";

/**
 * `::highlight()` is newer than the CSS pipeline Next runs in development, which rejects the selector
 * when it appears in a stylesheet, so the rule travels with the editor component instead.
 */
const CAPTURED_HIGHLIGHT_CSS = `::highlight(${CAPTURED_HIGHLIGHT_NAME}) {
  background-color: var(--highlight-passage);
  color: inherit;
}`;

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function getEditorText(editor: HTMLElement | null): string {
  return editor?.textContent ?? "";
}

/**
 * Length of the editor's text that comes before `node`, measured the same way as `getEditorText`.
 */
function textLengthBefore(editor: HTMLElement, node: Node): number {
  let total = 0;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();

  while (current) {
    if (current.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      total += current.textContent?.length ?? 0;
    }

    current = walker.nextNode();
  }

  return total;
}

/**
 * Offset of a DOM position in the editor's text.
 *
 * A selection that crosses a paragraph break reports its boundary against the block element rather than
 * a text node, so those positions are resolved by counting the text before the element and inside its
 * preceding children. Treating them as text-node offsets is what made multi-line highlights land in the
 * wrong place.
 */
function offsetWithin(editor: HTMLElement, node: Node, offsetInNode: number): number {
  const textBefore = textLengthBefore(editor, node);

  if (node.nodeType === Node.TEXT_NODE) {
    return textBefore + offsetInNode;
  }

  let total = textBefore;
  const children = node.childNodes;

  for (let index = 0; index < Math.min(offsetInNode, children.length); index += 1) {
    total += children[index]?.textContent?.length ?? 0;
  }

  return total;
}

function rangeFromOffsets(editor: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let total = 0;
  let hasStart = false;
  let current = walker.nextNode();

  while (current) {
    const length = current.textContent?.length ?? 0;

    if (!hasStart && total + length >= start) {
      range.setStart(current, Math.min(Math.max(start - total, 0), length));
      hasStart = true;
    }

    if (hasStart && total + length >= end) {
      range.setEnd(current, Math.min(Math.max(end - total, 0), length));
      return range;
    }

    total += length;
    current = walker.nextNode();
  }

  if (!hasStart) {
    return null;
  }

  range.setEnd(editor, editor.childNodes.length);
  return range;
}

/** Reads the passage currently selected inside the editor, if any. */
function readEditorSelection(editor: HTMLElement | null): EditorSelection | null {
  const selection = window.getSelection();

  if (!editor || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
    return null;
  }

  // The text is read back out of the editor rather than taken from selection.toString(), which reports
  // an extra newline for a selection that crosses a paragraph break. The editor's own text has no such
  // newline, so a passage described by toString() can never be found again when it is repainted or
  // replaced — which is exactly what happened to highlights that included an Enter.
  const content = getEditorText(editor);
  const selectedStart = offsetWithin(editor, range.startContainer, range.startOffset);
  const selected = content.slice(selectedStart, offsetWithin(editor, range.endContainer, range.endOffset));
  const text = selected.trim();

  if (!text) {
    return null;
  }

  const start = selectedStart + (selected.length - selected.trimStart().length);

  return { text, start, end: start + text.length };
}

export function RichTextEditor({ value, onChange, apiRef, onSelectionChange, highlight }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  /** True while the editor itself shows a selection, which the browser already paints. */
  const [hasLiveSelection, setHasLiveSelection] = useState(false);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  });

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    if (editor.innerHTML !== value) {
      editor.innerHTML = value || "<p></p>";
    }
  }, [value]);

  /**
   * The browser drops the editor's own selection as soon as focus moves to the chat box, so the
   * captured passage is painted with the CSS Custom Highlight API instead: it survives the editor
   * losing focus, and it never touches the letter's markup or the user's caret.
   */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || typeof Highlight === "undefined" || !CSS.highlights) {
      return;
    }

    // While the editor shows its own selection the browser paints it already, and adding the custom
    // highlight on top would double it up.
    const resolved = highlight && !hasLiveSelection ? resolveSelectionOffsets(getEditorText(editor), highlight) : null;
    const range = resolved ? rangeFromOffsets(editor, resolved.start, resolved.end) : null;

    if (!range) {
      CSS.highlights.delete(CAPTURED_HIGHLIGHT_NAME);
      return;
    }

    CSS.highlights.set(CAPTURED_HIGHLIGHT_NAME, new Highlight(range));

    return () => {
      CSS.highlights.delete(CAPTURED_HIGHLIGHT_NAME);
    };
  }, [highlight, hasLiveSelection, value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    /**
     * Whether the painted highlight is needed is decided from the same reader that feeds the panel's
     * "Highlighted passage" card, recomputed on every selection change and after the editor loses focus,
     * so the two can never disagree.
     */
    function handleSelectionChange() {
      const element = editorRef.current;
      if (!element) {
        return;
      }

      const selection = window.getSelection();
      const insideEditor = Boolean(
        selection &&
          selection.rangeCount > 0 &&
          element.contains(selection.getRangeAt(0).startContainer) &&
          element.contains(selection.getRangeAt(0).endContainer)
      );

      if (!insideEditor) {
        // Focus moved to the chat box: the editor's own selection is gone, so the painted highlight has
        // to take over. The passage the user already captured is deliberately left untouched.
        setHasLiveSelection(false);
        return;
      }

      const captured = readEditorSelection(element);
      setHasLiveSelection(captured !== null);
      onSelectionChangeRef.current?.(captured);
    }

    let refreshTimer = 0;

    function handleBlur() {
      // Blur fires before the selection moves, so re-check once the browser has settled instead of
      // assuming the editor no longer paints anything.
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        setHasLiveSelection(readEditorSelection(editorRef.current) !== null);
      }, 0);
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    editor.addEventListener("blur", handleBlur);

    return () => {
      window.clearTimeout(refreshTimer);
      document.removeEventListener("selectionchange", handleSelectionChange);
      editor.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!apiRef) {
      return;
    }

    function emitChange(editor: HTMLDivElement) {
      onChange(editor.innerHTML);
    }

    apiRef.current = {
      getText: () => getEditorText(editorRef.current),
      getHtml: () => editorRef.current?.innerHTML ?? "",
      getSelection: () => readEditorSelection(editorRef.current),
      replaceSelection: (selection, replacement) => {
        const element = editorRef.current;
        const html = revisionTextToHtml(replacement);
        if (!element || !html) {
          return null;
        }

        const resolved = resolveSelectionOffsets(getEditorText(element), selection);
        if (!resolved) {
          return null;
        }

        const range = rangeFromOffsets(element, resolved.start, resolved.end);
        if (!range) {
          return null;
        }

        element.focus();

        const domSelection = window.getSelection();
        if (!domSelection) {
          return null;
        }

        domSelection.removeAllRanges();
        domSelection.addRange(range);

        const lengthBefore = getEditorText(element).length;
        document.execCommand("insertHTML", false, html);

        // Keep the rewritten passage selected, so the highlight follows the change instead of vanishing.
        const rewritten = rewrittenSelectionOffsets(resolved, lengthBefore, getEditorText(element).length);
        const rewrittenRange = rewritten ? rangeFromOffsets(element, rewritten.start, rewritten.end) : null;

        if (rewrittenRange) {
          domSelection.removeAllRanges();
          domSelection.addRange(rewrittenRange);
        }

        emitChange(element);
        return readEditorSelection(element);
      },
      replaceDocument: (replacement) => {
        const element = editorRef.current;
        if (!element) {
          return;
        }

        element.innerHTML = plainTextToHtml(replacement);
        emitChange(element);
      }
    };

    return () => {
      apiRef.current = null;
    };
  }, [apiRef, onChange]);

  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{ __html: CAPTURED_HIGHLIGHT_CSS }} />
      <div className="surface-inset flex flex-wrap gap-2 rounded-2xl border p-2">
        <ToolbarButton label="Bold" onClick={() => exec("bold")} />
        <ToolbarButton label="Italic" onClick={() => exec("italic")} />
        <ToolbarButton label="Underline" onClick={() => exec("underline")} />
        <ToolbarButton label="Bullet list" onClick={() => exec("insertUnorderedList")} />
        <ToolbarButton label="Numbered list" onClick={() => exec("insertOrderedList")} />
        <ToolbarButton label="Clear" onClick={() => exec("removeFormat")} />
      </div>

      <div
        ref={editorRef}
        className="draft-editor surface-sunken min-h-[520px] rounded-[1.75rem] border p-5 text-[15px] leading-7 text-heading outline-none"
        contentEditable
        onInput={() => {
          const element = editorRef.current;
          if (element) {
            onChange(element.innerHTML);
          }
        }}
        role="textbox"
        suppressContentEditableWarning
      />

      <p className="text-xs text-muted">Word-style formatting is enabled. You can still paste plain text and edit everything directly.</p>
    </div>
  );
}

function ToolbarButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="surface-inset rounded-full border px-3 py-2 text-xs font-medium text-body transition hover:text-heading" type="button" onClick={onClick}>
      {label}
    </button>
  );
}
