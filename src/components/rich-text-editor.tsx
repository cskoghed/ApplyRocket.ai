"use client";

import { useEffect, useRef } from "react";

type RichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    if (editor.innerHTML !== value) {
      editor.innerHTML = value || "<p></p>";
    }
  }, [value]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    onChange(editor.innerHTML);
  }

  return (
    <div className="space-y-4">
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
        onInput={emitChange}
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
