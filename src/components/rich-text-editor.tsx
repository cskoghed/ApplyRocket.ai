"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { safeHtmlFromText } from "@/lib/editor-utils";

type Template = {
  id: string;
  label: string;
  content: string;
};

type RichTextEditorProps = {
  value: string;
  onChange: (value: string) => void;
  templates: Template[];
};

function exec(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function RichTextEditor({ value, onChange, templates }: RichTextEditorProps) {
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

  function insertTemplate(template: Template) {
    editorRef.current?.focus();
    exec("insertHTML", safeHtmlFromText(template.content));
    emitChange();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
        <ToolbarButton label="Bold" onClick={() => exec("bold")} />
        <ToolbarButton label="Italic" onClick={() => exec("italic")} />
        <ToolbarButton label="Underline" onClick={() => exec("underline")} />
        <ToolbarButton label="Bullet list" onClick={() => exec("insertUnorderedList")} />
        <ToolbarButton label="Numbered list" onClick={() => exec("insertOrderedList")} />
        <ToolbarButton label="Clear" onClick={() => exec("removeFormat")} />
      </div>

      <div className="flex flex-wrap gap-2">
        {templates.map((template) => (
          <button key={template.id} className="secondary-button text-xs" type="button" onClick={() => insertTemplate(template)}>
            {template.label}
          </button>
        ))}
      </div>

      <div
        ref={editorRef}
        className="draft-editor min-h-[520px] rounded-[1.75rem] border border-white/10 bg-slate-950/70 p-5 text-[15px] leading-7 text-slate-100 outline-none"
        contentEditable
        onInput={emitChange}
        role="textbox"
        suppressContentEditableWarning
      />

      <p className="text-xs text-slate-400">Word-style formatting is enabled. You can still paste plain text and edit everything directly.</p>
    </div>
  );
}

function ToolbarButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200" type="button" onClick={onClick}>
      {label}
    </button>
  );
}
