"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatBranchInfo } from "@/lib/chat-branches";
import type { EditorSelection } from "@/lib/editor-utils";
import type { CoverLetterChatMessage } from "@/lib/types";

type CoverLetterChatPanelProps = {
  messages: CoverLetterChatMessage[];
  /** Branch metadata by message id, for the turns that have more than one version. */
  branches: Record<string, ChatBranchInfo>;
  streamingText: string;
  pending: boolean;
  error: string | null;
  selection: EditorSelection | null;
  onClearSelection: () => void;
  onSend: (instruction: string) => void;
  onEditMessage: (id: string, content: string) => void;
  onDeleteMessage: (id: string) => void;
  onSwitchBranch: (id: string) => void;
};

const QUICK_PROMPTS = ["Make this more personal", "Tighten the wording", "Sound more confident", "Add a stronger closing"];

export function CoverLetterChatPanel({
  messages,
  branches,
  streamingText,
  pending,
  error,
  selection,
  onClearSelection,
  onSend,
  onEditMessage,
  onDeleteMessage,
  onSwitchBranch
}: CoverLetterChatPanelProps) {
  const [instruction, setInstruction] = useState("");
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);

  function submit() {
    const trimmed = instruction.trim();
    if (!trimmed || pending) {
      return;
    }

    onSend(trimmed);
    setInstruction("");
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = editing?.content.trim();
    if (!editing || !draft || pending) {
      return;
    }

    onEditMessage(editing.id, draft);
    setEditing(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function deleteMessage(message: CoverLetterChatMessage) {
    if (pending) {
      return;
    }

    const confirmed = window.confirm(
      message.role === "user"
        ? "Delete this message and everything after it? The letter goes back to how it was before you sent it."
        : "Delete this answer and everything after it? Its change to the letter is undone."
    );

    if (!confirmed) {
      return;
    }

    setEditing(null);
    onDeleteMessage(message.id);
  }

  return (
    <section className="surface-panel flex min-h-[760px] flex-col rounded-[2rem] p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Draft assistant</p>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-heading">Ask for changes</h2>
          <p className="mt-2 text-sm leading-6 text-body">
            Highlight a passage in the letter to scope a change to just that text, or simply say what to
            change and only that part of the letter is rewritten. Use the pen on one of your messages to rework
            it as a new branch of the conversation, or the trash to delete it and undo its change.
          </p>
        </div>
      </div>

      <div className="chat-scroll mt-5 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && !streamingText ? (
          <p className="border-subtle rounded-2xl border border-dashed p-4 text-xs leading-5 text-muted">
            Nothing here yet. Try &ldquo;make the introduction more personal&rdquo; after highlighting it, or ask for a change and only that part of the letter is touched.
          </p>
        ) : null}

        {messages.map((message) => (
          <article key={message.id} className={`chat-bubble ${message.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`}>
            {editing?.id === message.id ? (
              <form className="space-y-2" onSubmit={submitEdit}>
                <textarea
                  autoFocus
                  aria-label="Edit your message"
                  className="surface-inset w-full rounded-xl border p-2 text-sm"
                  onChange={(event) => setEditing({ id: message.id, content: event.target.value })}
                  rows={3}
                  value={editing.content}
                />
                <div className="flex items-center gap-2">
                  <button className="primary-button px-3 py-1 text-[11px]" disabled={pending || !editing.content.trim()} type="submit">
                    Save and resend
                  </button>
                  <button
                    className="rounded-full border px-3 py-1 text-[11px] text-body"
                    disabled={pending}
                    onClick={() => setEditing(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.selection ? <p className="mt-2 text-[11px] italic opacity-80">Scoped to: &ldquo;{truncate(message.selection)}&rdquo;</p> : null}
                {message.revision ? (
                  <p className="mt-2 text-[11px] uppercase tracking-[0.18em] opacity-80">
                    {message.revision.scope === "selection" ? "Applied to highlighted passage" : "Applied to your letter"}
                  </p>
                ) : null}
                <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                  <span className="flex items-center gap-1">
                    {message.role === "user" ? (
                      <button
                        aria-label="Edit this message"
                        className="rounded-full p-1 opacity-70 transition hover:opacity-100 disabled:opacity-30"
                        disabled={pending}
                        onClick={() => setEditing({ id: message.id, content: message.content })}
                        title="Edit this message"
                        type="button"
                      >
                        <PenIcon />
                      </button>
                    ) : null}
                    <button
                      aria-label="Delete this message"
                      className="rounded-full p-1 opacity-70 transition hover:opacity-100 disabled:opacity-30"
                      disabled={pending}
                      onClick={() => deleteMessage(message)}
                      title="Delete this message"
                      type="button"
                    >
                      <TrashIcon />
                    </button>
                  </span>
                  {branches[message.id] ? (
                    <BranchSwitcher info={branches[message.id]!} disabled={pending} onSelect={onSwitchBranch} />
                  ) : null}
                </div>
              </>
            )}
          </article>
        ))}

        {streamingText ? (
          <article className="chat-bubble chat-bubble-assistant">
            <p className="whitespace-pre-wrap">
              {streamingText}
              <span className="chat-cursor" />
            </p>
          </article>
        ) : null}

        {pending && !streamingText ? (
          <article className="chat-bubble chat-bubble-assistant">
            <p className="text-muted">
              Thinking
              <span className="chat-cursor" />
            </p>
          </article>
        ) : null}
      </div>

      {error ? <p className="danger-banner mt-4 rounded-2xl p-3 text-xs leading-5">{error}</p> : null}

      {selection ? (
        <div className="surface-inset mt-4 rounded-2xl border p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Highlighted passage</p>
              <p className="mt-1 text-xs leading-5 text-body">&ldquo;{truncate(selection.text)}&rdquo;</p>
            </div>
            <button className="text-xs text-muted hover:text-heading" onClick={onClearSelection} type="button">
              Clear
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">No selection captured, so I change only the text your message refers to.</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            className="surface-inset rounded-full border px-3 py-1.5 text-[11px] font-medium text-body transition hover:text-heading"
            disabled={pending}
            onClick={() => setInstruction(prompt)}
            type="button"
          >
            {prompt}
          </button>
        ))}
      </div>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <label className="block">
          <span className="sr-only">Message</span>
          <textarea
            rows={3}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selection ? "Tell the AI how to change the highlighted text..." : "Ask for a change to the letter..."}
          />
        </label>
        <div className="flex items-center gap-3">
          <button className="primary-button flex-1" disabled={pending || !instruction.trim()} type="submit">
            {pending ? "Working..." : "Send"}
          </button>
        </div>
      </form>

      <p className="mt-3 text-[11px] leading-5 text-faint">
        Enter sends, Shift + Enter starts a new line. Changes are saved with the rest of your application.
      </p>
    </section>
  );
}

function BranchSwitcher({ info, disabled, onSelect }: { info: ChatBranchInfo; disabled: boolean; onSelect: (id: string) => void }) {  const previous = info.index > 1 ? info.ids[info.index - 2] : undefined;
  const next = info.index < info.total ? info.ids[info.index] : undefined;

  return (
    <span className="inline-flex items-center gap-1" title="Versions of this message">
      <button
        aria-label="Previous branch"
        className="px-1 transition disabled:opacity-30"
        disabled={disabled || !previous}
        onClick={() => previous && onSelect(previous)}
        type="button"
      >
        ‹
      </button>
      <span className="opacity-80">
        {info.index}/{info.total}
      </span>
      <button
        aria-label="Next branch"
        className="px-1 transition disabled:opacity-30"
        disabled={disabled || !next}
        onClick={() => next && onSelect(next)}
        type="button"
      >
        ›
      </button>
    </span>
  );
}

function PenIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
      <path
        d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
      <path d="M3 6h18" strokeLinecap="round" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6M14 11v6" strokeLinecap="round" />
    </svg>
  );
}

function truncate(text: string, limit = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}
