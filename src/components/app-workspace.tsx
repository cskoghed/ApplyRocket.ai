"use client";

import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { RichTextEditor } from "@/components/rich-text-editor";
import { buildDocumentContextSummary, createDocumentRecord, detectDocumentKind, formatFileSize, getUploadLimitMessage, validateUpload } from "@/lib/file-utils";
import { draftTemplatesForBrief } from "@/lib/cover-letter";
import { htmlToPlainText, plainTextToHtml } from "@/lib/editor-utils";
import type { CoverLetterDraft, JobBrief, UploadedDocument, WorkspaceRecord, WorkspaceSnapshot } from "@/lib/types";

type GenerationStatus = "idle" | "loading" | "success" | "error";

const STORAGE_KEY = "applyrocket.workspace.v1";

const defaultBrief: JobBrief = {
  role: "Product Manager",
  company: "Acme Studio",
  location: "Remote",
  tone: "confident",
  description:
    "Looking for a thoughtful operator who can work across product, design, and engineering to turn ambiguity into execution."
};

const defaultDraft: CoverLetterDraft = {
  title: "Your cover letter will appear here",
  content: "Upload your CV and any supporting documents, then generate a first draft to begin editing.",
  summary: "Ready for a first draft.",
  bullets: ["Upload files", "Describe the role", "Generate a draft"],
  provider: "template",
  generatedAt: new Date().toISOString()
};

function safeParseWorkspace(serialized: string | null): WorkspaceRecord | null {
  if (!serialized) {
    return null;
  }

  try {
    return JSON.parse(serialized) as WorkspaceRecord;
  } catch {
    return null;
  }
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AppWorkspace() {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [brief, setBrief] = useState<JobBrief>(defaultBrief);
  const [draft, setDraft] = useState<CoverLetterDraft>(defaultDraft);
  const [editedContent, setEditedContent] = useState(plainTextToHtml(defaultDraft.content));
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Waiting for your first upload.");
  const [hasHydrated, setHasHydrated] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [workspaceList, setWorkspaceList] = useState<Array<{ id: string; updatedAt: string; brief: JobBrief }>>([]);

  useEffect(() => {
    let active = true;

    async function hydrateWorkspace() {
      const restored = safeParseWorkspace(window.localStorage.getItem(STORAGE_KEY));
      const storedWorkspaceId = window.localStorage.getItem(`${STORAGE_KEY}.id`);

      if (restored) {
        setDocuments(restored.documents ?? []);
        setBrief(restored.brief ?? defaultBrief);
        setDraft(restored.draft ?? defaultDraft);
        setEditedContent(plainTextToHtml(restored.editedContent ?? restored.draft?.content ?? defaultDraft.content));
        setWorkspaceId(restored.id ?? storedWorkspaceId ?? null);
        setStatusMessage("Workspace restored from your last session.");
      }

      try {
        const response = await fetch("/api/workspaces");
        if (response.ok) {
          const payload = (await response.json()) as { workspaces?: Array<{ id: string; updatedAt: string; brief: JobBrief }> };
          if (active) {
            setWorkspaceList(payload.workspaces ?? []);
          }
        }
      } catch {
        // Remote list is optional.
      }

      if (!storedWorkspaceId) {
        try {
          const response = await fetch("/api/workspaces", { method: "GET" });
          if (response.ok) {
            const payload = (await response.json()) as { workspaces?: Array<{ id: string; updatedAt: string; brief: JobBrief }> };
            if (active && !storedWorkspaceId && payload.workspaces?.length) {
              const recent = payload.workspaces[0];
              window.localStorage.setItem(`${STORAGE_KEY}.id`, recent.id);
              setWorkspaceId(recent.id);

              const workspaceResponse = await fetch(`/api/workspaces/${recent.id}`);
              if (workspaceResponse.ok) {
                const workspacePayload = (await workspaceResponse.json()) as { workspace?: WorkspaceRecord };
                const workspace = workspacePayload.workspace;
                if (workspace) {
                  setDocuments(workspace.documents ?? []);
                  setBrief(workspace.brief ?? defaultBrief);
                  setDraft(workspace.draft ?? defaultDraft);
                  setEditedContent(plainTextToHtml(workspace.editedContent ?? workspace.draft?.content ?? defaultDraft.content));
                  setStatusMessage("Loaded your latest saved workspace from the server.");
                }
              }
            }
          }
        } catch {
          // Use local state if server persistence is unavailable.
        }
      }

      if (active) {
        setHasHydrated(true);
      }
    }

    void hydrateWorkspace();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    const payload: WorkspaceSnapshot = {
      brief,
      draft,
      documents,
      editedContent: htmlToPlainText(editedContent)
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    if (workspaceId) {
      const timer = window.setTimeout(async () => {
        setSyncStatus("saving");

        try {
          const response = await fetch(`/api/workspaces/${workspaceId}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            throw new Error("Failed to save workspace.");
          }

          setSyncStatus("saved");
        } catch {
          setSyncStatus("error");
        }
      }, 500);

      return () => window.clearTimeout(timer);
    }
  }, [brief, draft, documents, editedContent, hasHydrated, workspaceId]);

  const canGenerate = useMemo(() => {
    return brief.role.trim().length > 0 && brief.company.trim().length > 0 && brief.description.trim().length > 0;
  }, [brief.company, brief.description, brief.role]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }

    const validationErrors = files.map((file) => validateUpload(file)).filter((message): message is string => Boolean(message));
    if (validationErrors.length) {
      setUploadError(validationErrors.join(" "));
      setStatusMessage("Fix the upload issue and try again.");
      event.target.value = "";
      return;
    }

    const startIndex = documents.length;
    const records = await Promise.all(
      files.map((file, index) => createDocumentRecord(file, detectDocumentKind(file, startIndex + index === 0)))
    );

    setUploadError(null);
    setDocuments((current) => [...current, ...records].slice(0, 8));
    setStatusMessage(`${records.length} file${records.length === 1 ? "" : "s"} added.`);
    event.target.value = "";
  }

  function removeDocument(id: string) {
    setDocuments((current) => current.filter((document) => document.id !== id));
  }

  function resetWorkspace() {
    setDocuments([]);
    setBrief(defaultBrief);
    setDraft(defaultDraft);
    setEditedContent(plainTextToHtml(defaultDraft.content));
    setGenerationStatus("idle");
    setUploadError(null);
    setStatusMessage("Workspace reset.");
  }

  function exportWorkspace() {
    const snapshot: WorkspaceSnapshot = {
      brief,
      draft,
      documents,
      editedContent
    };

    downloadTextFile(`${brief.company || "applyrocket"}-workspace.json`, JSON.stringify(snapshot, null, 2));
    setStatusMessage("Workspace exported as JSON.");
  }

  async function regenerateFromCurrentDraft() {
    setDraft((current) => ({
      ...current,
      title: `${brief.role} cover letter`,
      summary: `Refreshing the draft for ${brief.role}${brief.company ? ` at ${brief.company}` : ""}.`,
      provider: current.provider,
      generatedAt: new Date().toISOString()
    }));

    setStatusMessage("Current draft refreshed from your edits.");
  }

  async function generateDraft() {
    if (!canGenerate) {
      setGenerationStatus("error");
      setStatusMessage("Fill in the role, company, and job description before generating.");
      return;
    }

    setGenerationStatus("loading");
    setStatusMessage("Generating a tailored cover letter.");

    try {
      const response = await fetch("/api/generate-cover-letter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          brief,
          documents
        })
      });

      const payload = (await response.json()) as { draft?: CoverLetterDraft; error?: string };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error || "Failed to generate a draft.");
      }

      setDraft(payload.draft);
      setEditedContent(plainTextToHtml(payload.draft.content));
      setGenerationStatus("success");
      setStatusMessage(`Draft generated with ${payload.draft.provider}.`);
    } catch (error) {
      setGenerationStatus("error");
      setStatusMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  async function copyDraft() {
    await navigator.clipboard.writeText(htmlToPlainText(editedContent));
    setStatusMessage("Draft copied to the clipboard.");
  }

  function exportDraft() {
    const filename = `${brief.company || "applyrocket"}-cover-letter.txt`;
    downloadTextFile(filename, htmlToPlainText(editedContent));
    setStatusMessage("Draft exported as a text file.");
  }

  async function createWorkspace() {
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          brief,
          draft,
          documents,
          editedContent: htmlToPlainText(editedContent)
        })
      });

      if (!response.ok) {
        throw new Error("Unable to create workspace.");
      }

      const payload = (await response.json()) as { workspace?: WorkspaceRecord };
      if (payload.workspace) {
        window.localStorage.setItem(`${STORAGE_KEY}.id`, payload.workspace.id);
        setWorkspaceId(payload.workspace.id);
        setWorkspaceList((current) => [
          { id: payload.workspace!.id, updatedAt: payload.workspace!.updatedAt, brief: payload.workspace!.brief },
          ...current.filter((workspace) => workspace.id !== payload.workspace!.id)
        ]);
        setStatusMessage("Workspace created on the server.");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Workspace creation failed.");
    }
  }

  async function loadWorkspace(id: string) {
    try {
      const response = await fetch(`/api/workspaces/${id}`);
      if (!response.ok) {
        throw new Error("Workspace not found.");
      }

      const payload = (await response.json()) as { workspace?: WorkspaceRecord };
      if (!payload.workspace) {
        throw new Error("Workspace not found.");
      }

      const workspace = payload.workspace;
      setDocuments(workspace.documents ?? []);
      setBrief(workspace.brief ?? defaultBrief);
      setDraft(workspace.draft ?? defaultDraft);
      setEditedContent(plainTextToHtml(workspace.editedContent ?? workspace.draft?.content ?? defaultDraft.content));
      window.localStorage.setItem(`${STORAGE_KEY}.id`, workspace.id);
      setWorkspaceId(workspace.id);
      setStatusMessage(`Loaded workspace ${workspace.id}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to load workspace.");
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section className="glass-panel space-y-6 rounded-[2rem] p-6 shadow-glow">
        <div>
          <p className="eyebrow">ApplyRocket.AI</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Upload your application materials, generate a cover letter, and rewrite it in place.
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">
            This first slice gives you a working workspace for uploading documents, shaping the job brief,
            and iterating on the draft without leaving the page.
          </p>
        </div>

        <label className="upload-zone block cursor-pointer rounded-3xl border border-dashed border-white/15 p-5 transition hover:border-cyan-300/60 hover:bg-white/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Upload CV and supporting files</p>
              <p className="mt-1 text-xs text-slate-400">PDF, DOCX, TXT, MD, and similar documents.</p>
            </div>
            <span className="rounded-full bg-cyan-400/15 px-3 py-1 text-xs font-medium text-cyan-200">
              Browse
            </span>
          </div>
          <input className="sr-only" multiple type="file" onChange={handleUpload} />
        </label>
        <p className="text-xs leading-5 text-slate-400">{getUploadLimitMessage()}</p>
        {uploadError ? <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">{uploadError}</p> : null}

        <div className="space-y-4">
          <Field label="Target role">
            <input
              value={brief.role}
              onChange={(event) => setBrief((current) => ({ ...current, role: event.target.value }))}
              placeholder="Senior Product Manager"
            />
          </Field>
          <Field label="Company">
            <input
              value={brief.company}
              onChange={(event) => setBrief((current) => ({ ...current, company: event.target.value }))}
              placeholder="ApplyRocket"
            />
          </Field>
          <Field label="Location">
            <input
              value={brief.location}
              onChange={(event) => setBrief((current) => ({ ...current, location: event.target.value }))}
              placeholder="Remote"
            />
          </Field>
          <Field label="Tone">
            <select
              value={brief.tone}
              onChange={(event) => setBrief((current) => ({ ...current, tone: event.target.value as JobBrief["tone"] }))}
            >
              <option value="formal">Formal</option>
              <option value="confident">Confident</option>
              <option value="warm">Warm</option>
              <option value="direct">Direct</option>
            </select>
          </Field>
          <Field label="Job description">
            <textarea
              rows={7}
              value={brief.description}
              onChange={(event) => setBrief((current) => ({ ...current, description: event.target.value }))}
              placeholder="Paste the job posting or a working summary here."
            />
          </Field>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Saved workspaces</p>
              <p className="text-xs text-slate-400">Server-backed recovery from the local JSON store.</p>
            </div>
            <button className="secondary-button text-xs" type="button" onClick={createWorkspace}>
              Save as new
            </button>
          </div>

          <div className="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
            {workspaceList.length ? (
              workspaceList.map((workspace) => (
                <button
                  key={workspace.id}
                  className="block w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-left text-sm text-slate-200 hover:border-cyan-300/50"
                  type="button"
                  onClick={() => loadWorkspace(workspace.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-white">{workspace.brief.company || "Untitled workspace"}</span>
                    <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{workspace.id.slice(0, 8)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{workspace.brief.role}</p>
                </button>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-white/10 p-3 text-xs text-slate-400">
                No saved workspaces yet. Click save to create one.
              </p>
            )}
          </div>
        </div>

        <button
          className="primary-button w-full"
          disabled={!canGenerate || generationStatus === "loading"}
          onClick={generateDraft}
          type="button"
        >
          {generationStatus === "loading" ? "Generating…" : "Generate cover letter"}
        </button>

        <div className="grid gap-3 sm:grid-cols-2">
          <button className="secondary-button w-full" onClick={regenerateFromCurrentDraft} type="button">
            Refresh draft metadata
          </button>
          <button className="secondary-button w-full" onClick={resetWorkspace} type="button">
            Reset workspace
          </button>
          <button className="secondary-button w-full sm:col-span-2" onClick={exportWorkspace} type="button">
            Export workspace JSON
          </button>
        </div>

        <p className={`text-sm ${generationStatus === "error" ? "text-rose-300" : "text-slate-400"}`}>{statusMessage}</p>

        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Uploaded files</h2>
            <span className="text-xs text-slate-500">{documents.length}/8</span>
          </div>

          <div className="mt-3 space-y-3">
            {documents.length ? (
              documents.map((document) => (
                <article key={document.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-white">{document.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-cyan-200">{document.kind}</p>
                    </div>
                    <button className="text-xs text-slate-400 hover:text-white" onClick={() => removeDocument(document.id)} type="button">
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
                    <span>{formatFileSize(document.size)}</span>
                    <span>{document.type || "unknown type"}</span>
                  </div>
                </article>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                No files uploaded yet. Start with your CV, then add any supporting documents you want the agent to use.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="glass-panel flex min-h-[760px] flex-col rounded-[2rem] p-6 shadow-glow">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Editable draft</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">{draft.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{draft.summary}</p>
          </div>
          <div className="flex gap-3">
            <button className="secondary-button" onClick={copyDraft} type="button">
              Copy
            </button>
            <button className="secondary-button" onClick={exportDraft} type="button">
              Download
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          <p className="font-medium text-white">Current document summary</p>
          <p className="mt-2 whitespace-pre-wrap text-slate-300">{buildDocumentContextSummary(documents)}</p>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {draft.bullets.map((bullet) => (
            <div key={bullet} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
              {bullet}
            </div>
          ))}
        </div>

        <div className="mt-6 flex-1 rounded-[1.75rem] border border-white/10 bg-slate-950/70 p-4">
          <RichTextEditor
            value={editedContent}
            onChange={setEditedContent}
            templates={draftTemplatesForBrief(brief.role, brief.company)}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <span>{draft.provider === "openai" ? "Generated with OpenAI" : "Template draft ready for editing"}</span>
          <span>Last generated {new Date(draft.generatedAt).toLocaleString()}</span>
          <span>Sync: {syncStatus}</span>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

