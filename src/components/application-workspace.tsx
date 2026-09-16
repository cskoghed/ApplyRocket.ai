"use client";

import type { ChangeEvent, DragEvent, FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { RichTextEditor } from "@/components/rich-text-editor";
import { htmlToPlainText, plainTextToHtml } from "@/lib/editor-utils";
import { createDocumentRecord, detectDocumentKind, getUploadLimitMessage, validateUpload } from "@/lib/file-utils";
import type { ApplicationRecord, ApplicationSnapshot, AuthUser, CoverLetterDraft, DocumentRecord, JobBrief } from "@/lib/types";

type GenerationStatus = "idle" | "loading" | "success" | "error";
type AuthMode = "login" | "register";
type ApplicationListItem = { id: string; updatedAt: string; brief: JobBrief };
type LocalApplicationState = ApplicationSnapshot & { id?: string };

const MAX_DOCUMENTS_PER_APPLICATION = 8;
const STORAGE_KEY = "applyrocket.application.v1";

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
  generatedAt: ""
};

function providerLabel(provider: CoverLetterDraft["provider"]): string {
  switch (provider) {
    case "openai":
      return "Generated with OpenAI";
    case "anthropic":
      return "Generated with Anthropic";
    case "gemini":
      return "Generated with Gemini";
    case "template":
    default:
      return "Template draft ready for editing";
  }
}

function getApplicationStorageKey(userId: string): string {
  return `${STORAGE_KEY}.${userId}`;
}

function safeParseApplicationState(serialized: string | null): LocalApplicationState | null {
  if (!serialized) {
    return null;
  }

  try {
    return JSON.parse(serialized) as LocalApplicationState;
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

export function ApplicationWorkspace() {
  const [documentLibrary, setDocumentLibrary] = useState<DocumentRecord[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [brief, setBrief] = useState<JobBrief>(defaultBrief);
  const [draft, setDraft] = useState<CoverLetterDraft>(defaultDraft);
  const [editedContent, setEditedContent] = useState(plainTextToHtml(defaultDraft.content));
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Sign in to access your application.");
  const [hasHydrated, setHasHydrated] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [applicationList, setApplicationList] = useState<ApplicationListItem[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPending, setAuthPending] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMessage, setAuthMessage] = useState("Create an account or sign in to access your saved applications.");

  const selectedDocuments = useMemo(
    () => selectedDocumentIds.map((id) => documentLibrary.find((document) => document.id === id)).filter((document): document is DocumentRecord => Boolean(document)),
    [documentLibrary, selectedDocumentIds]
  );

  function resetApplicationState() {
    setSelectedDocumentIds([]);
    setBrief(defaultBrief);
    setDraft(defaultDraft);
    setEditedContent(plainTextToHtml(defaultDraft.content));
    setApplicationId(null);
    setGenerationStatus("idle");
    setUploadError(null);
    setSyncStatus("idle");
    setApplicationList([]);
  }

  function applyApplicationRecord(application: ApplicationRecord) {
    setSelectedDocumentIds(application.documentIds ?? []);
    setBrief(application.brief ?? defaultBrief);
    setDraft(application.draft ?? defaultDraft);
    setEditedContent(plainTextToHtml(application.editedContent ?? application.draft?.content ?? defaultDraft.content));
    setApplicationId(application.id);
  }

  async function handleUnauthorized(message: string) {
    resetApplicationState();
    setAuthUser(null);
    setHasHydrated(true);
    setAuthChecked(true);
    setStatusMessage(message);
    setAuthMessage(message);
  }

  async function fetchApplicationById(id: string): Promise<ApplicationRecord | null> {
    const response = await fetch(`/api/applications/${id}`);
    const payload = (await response.json().catch(() => ({}))) as { application?: ApplicationRecord; error?: string };

    if (response.status === 401) {
      await handleUnauthorized(payload.error || "Your session expired. Sign in again.");
      return null;
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok || !payload.application) {
      throw new Error(payload.error || "Unable to load application.");
    }

    return payload.application;
  }

  async function loadApplicationListForUser(): Promise<ApplicationListItem[]> {
    const response = await fetch("/api/applications");
    const payload = (await response.json().catch(() => ({}))) as { applications?: ApplicationListItem[]; error?: string };

    if (response.status === 401) {
      await handleUnauthorized(payload.error || "Your session expired. Sign in again.");
      return [];
    }

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load applications.");
    }

    const applications = payload.applications ?? [];
    setApplicationList(applications);
    return applications;
  }

  async function loadDocumentLibraryForUser(): Promise<DocumentRecord[]> {
    const response = await fetch("/api/documents");
    const payload = (await response.json().catch(() => ({}))) as { documents?: DocumentRecord[]; error?: string };

    if (response.status === 401) {
      await handleUnauthorized(payload.error || "Your session expired. Sign in again.");
      return [];
    }

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load your document library.");
    }

    const documents = payload.documents ?? [];
    setDocumentLibrary(documents);
    return documents;
  }

  async function hydrateApplicationForUser(user: AuthUser) {
    setHasHydrated(false);
    const storageKey = getApplicationStorageKey(user.id);
    const restored = safeParseApplicationState(window.localStorage.getItem(storageKey));
    const storedApplicationId = window.localStorage.getItem(`${storageKey}.id`);

    if (restored) {
      setSelectedDocumentIds(restored.documentIds ?? []);
      setBrief(restored.brief ?? defaultBrief);
      setDraft(restored.draft ?? defaultDraft);
      setEditedContent(plainTextToHtml(restored.editedContent ?? restored.draft?.content ?? defaultDraft.content));
      setApplicationId(restored.id ?? storedApplicationId ?? null);
      setStatusMessage("Application restored from this account's last session.");
    } else {
      resetApplicationState();
    }

    try {
      await loadDocumentLibraryForUser();
      const applications = await loadApplicationListForUser();
      const initialApplicationId = storedApplicationId ?? restored?.id ?? null;

      if (initialApplicationId) {
        const remoteApplication = await fetchApplicationById(initialApplicationId);
        if (remoteApplication) {
          applyApplicationRecord(remoteApplication);
          setStatusMessage("Loaded your saved application.");
        } else {
          window.localStorage.removeItem(`${storageKey}.id`);
          setApplicationId(null);
        }
      } else if (!restored && applications.length > 0) {
        const remoteApplication = await fetchApplicationById(applications[0]!.id);
        if (remoteApplication) {
          applyApplicationRecord(remoteApplication);
          window.localStorage.setItem(`${storageKey}.id`, remoteApplication.id);
          setStatusMessage("Loaded your latest saved application.");
        }
      }
    } finally {
      setHasHydrated(true);
    }
  }

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const response = await fetch("/api/auth/session");
        const payload = (await response.json().catch(() => ({}))) as { user?: AuthUser | null };

        if (!active) {
          return;
        }

        if (response.ok && payload.user) {
          setAuthUser(payload.user);
          setAuthMessage(`Signed in as ${payload.user.email}.`);
          await hydrateApplicationForUser(payload.user);
        } else {
          resetApplicationState();
          setHasHydrated(true);
        }
      } catch {
        if (active) {
          setAuthMessage("Unable to verify your session right now.");
          setHasHydrated(true);
        }
      } finally {
        if (active) {
          setAuthChecked(true);
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasHydrated || !authUser) {
      return;
    }

    const payload: ApplicationSnapshot = {
      brief,
      draft,
      documentIds: selectedDocumentIds,
      editedContent: htmlToPlainText(editedContent)
    };

    const storageKey = getApplicationStorageKey(authUser.id);
    window.localStorage.setItem(storageKey, JSON.stringify({ ...payload, id: applicationId ?? undefined }));

    if (!applicationId) {
      return;
    }

    const timer = window.setTimeout(async () => {
      setSyncStatus("saving");

      try {
        const response = await fetch(`/api/applications/${applicationId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        const result = (await response.json().catch(() => ({}))) as { error?: string };

        if (response.status === 401) {
          await handleUnauthorized(result.error || "Your session expired. Sign in again.");
          return;
        }

        if (!response.ok) {
          throw new Error(result.error || "Failed to save application.");
        }

        setSyncStatus("saved");
      } catch {
        setSyncStatus("error");
      }
    }, 500);

    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, brief, selectedDocumentIds, draft, editedContent, hasHydrated, applicationId]);

  const canGenerate = useMemo(() => {
    return brief.role.trim().length > 0 && brief.company.trim().length > 0 && brief.description.trim().length > 0;
  }, [brief.company, brief.description, brief.role]);

  async function submitAuthForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthPending(true);
    setAuthMessage(authMode === "login" ? "Signing you in..." : "Creating your account...");

    try {
      const response = await fetch(authMode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: authEmail,
          password: authPassword
        })
      });

      const payload = (await response.json().catch(() => ({}))) as { user?: AuthUser; error?: string };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error || "Authentication failed.");
      }

      setAuthUser(payload.user);
      setAuthPassword("");
      setAuthMessage(authMode === "login" ? `Signed in as ${payload.user.email}.` : `Account created for ${payload.user.email}.`);
      setStatusMessage("Loading your application...");
      await hydrateApplicationForUser(payload.user);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setAuthPending(false);
      setAuthChecked(true);
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      resetApplicationState();
      setDocumentLibrary([]);
      setAuthUser(null);
      setHasHydrated(true);
      setAuthChecked(true);
      setStatusMessage("Signed out.");
      setAuthMessage("Signed out. Sign back in to access your saved applications.");
    }
  }

  async function processFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) {
      return;
    }

    const validationErrors = files.map((file) => validateUpload(file)).filter((message): message is string => Boolean(message));
    if (validationErrors.length) {
      setUploadError(validationErrors.join(" "));
      setStatusMessage("Fix the upload issue and try again.");
      return;
    }

    const startIndex = documentLibrary.length;
    const drafts = await Promise.all(files.map((file, index) => createDocumentRecord(file, detectDocumentKind(file, startIndex + index === 0))));

    setUploadError(null);

    try {
      const createdDocuments = await Promise.all(
        drafts.map(async (draftDocument) => {
          const response = await fetch("/api/documents", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(draftDocument)
          });
          const result = (await response.json().catch(() => ({}))) as { document?: DocumentRecord; error?: string };

          if (response.status === 401) {
            await handleUnauthorized(result.error || "Your session expired. Sign in again.");
            throw new Error("unauthorized");
          }

          if (!response.ok || !result.document) {
            throw new Error(result.error || `Failed to save ${draftDocument.name}.`);
          }

          return result.document;
        })
      );

      setDocumentLibrary((current) => [...createdDocuments, ...current]);
      setSelectedDocumentIds((current) => Array.from(new Set([...current, ...createdDocuments.map((document) => document.id)])).slice(0, MAX_DOCUMENTS_PER_APPLICATION));
      setStatusMessage(`${createdDocuments.length} file${createdDocuments.length === 1 ? "" : "s"} added to your library and attached.`);
    } catch (error) {
      if (error instanceof Error && error.message !== "unauthorized") {
        setUploadError(error.message);
        setStatusMessage("Fix the upload issue and try again.");
      }
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    await processFiles(event.target.files ?? []);
    event.target.value = "";
  }

  function handleUploadDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDraggingOver(true);
  }

  function handleUploadDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
  }

  async function handleUploadDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    await processFiles(event.dataTransfer.files);
  }

  function toggleDocumentSelection(id: string) {
    setSelectedDocumentIds((current) => {
      if (current.includes(id)) {
        return current.filter((documentId) => documentId !== id);
      }

      if (current.length >= MAX_DOCUMENTS_PER_APPLICATION) {
        setStatusMessage(`You can attach up to ${MAX_DOCUMENTS_PER_APPLICATION} documents to an application.`);
        return current;
      }

      return [...current, id];
    });
  }

  async function deleteFromLibrary(id: string) {
    try {
      const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      const result = (await response.json().catch(() => ({}))) as { deleted?: boolean; error?: string };

      if (response.status === 401) {
        await handleUnauthorized(result.error || "Your session expired. Sign in again.");
        return;
      }

      if (!response.ok) {
        throw new Error(result.error || "Unable to delete document.");
      }

      setDocumentLibrary((current) => current.filter((document) => document.id !== id));
      setSelectedDocumentIds((current) => current.filter((documentId) => documentId !== id));
      setStatusMessage("Document removed from your library.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to delete document.");
    }
  }

  function resetApplication() {
    setSelectedDocumentIds([]);
    setBrief(defaultBrief);
    setDraft(defaultDraft);
    setEditedContent(plainTextToHtml(defaultDraft.content));
    setGenerationStatus("idle");
    setUploadError(null);
    setStatusMessage("Application reset.");
  }

  function exportApplication() {
    const snapshot: ApplicationSnapshot & { documents: DocumentRecord[] } = {
      brief,
      draft,
      documentIds: selectedDocumentIds,
      documents: selectedDocuments,
      editedContent
    };

    downloadTextFile(`${brief.company || "applyrocket"}-application.json`, JSON.stringify(snapshot, null, 2));
    setStatusMessage("Application exported as JSON.");
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
    if (!authUser) {
      await handleUnauthorized("Sign in to generate cover letters.");
      return;
    }

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
          documents: selectedDocuments
        })
      });

      const payload = (await response.json().catch(() => ({}))) as { draft?: CoverLetterDraft; error?: string };
      if (response.status === 401) {
        await handleUnauthorized(payload.error || "Your session expired. Sign in again.");
        return;
      }

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

  async function createApplication() {
    if (!authUser) {
      await handleUnauthorized("Sign in to save applications.");
      return;
    }

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          brief,
          draft,
          documentIds: selectedDocumentIds,
          editedContent: htmlToPlainText(editedContent)
        })
      });

      const payload = (await response.json().catch(() => ({}))) as { application?: ApplicationRecord; error?: string };
      if (response.status === 401) {
        await handleUnauthorized(payload.error || "Your session expired. Sign in again.");
        return;
      }

      if (!response.ok || !payload.application) {
        throw new Error(payload.error || "Unable to create application.");
      }

      const createdApplication = payload.application;
      const storageKey = getApplicationStorageKey(authUser.id);
      window.localStorage.setItem(`${storageKey}.id`, createdApplication.id);
      setApplicationId(createdApplication.id);
      setApplicationList((current) => [
        { id: createdApplication.id, updatedAt: createdApplication.updatedAt, brief: createdApplication.brief },
        ...current.filter((application) => application.id !== createdApplication.id)
      ]);
      setStatusMessage("Application created on the server.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Application creation failed.");
    }
  }

  async function loadApplication(id: string) {
    if (!authUser) {
      await handleUnauthorized("Sign in to load applications.");
      return;
    }

    try {
      const application = await fetchApplicationById(id);
      if (!application) {
        throw new Error("Application not found.");
      }

      applyApplicationRecord(application);
      const storageKey = getApplicationStorageKey(authUser.id);
      window.localStorage.setItem(`${storageKey}.id`, application.id);
      setStatusMessage(`Loaded application ${application.id}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to load application.");
    }
  }

  async function deleteApplication(id: string) {
    if (!authUser) {
      await handleUnauthorized("Sign in to delete applications.");
      return;
    }

    try {
      const response = await fetch(`/api/applications/${id}`, { method: "DELETE" });
      const result = (await response.json().catch(() => ({}))) as { deleted?: boolean; error?: string };

      if (response.status === 401) {
        await handleUnauthorized(result.error || "Your session expired. Sign in again.");
        return;
      }

      if (!response.ok) {
        throw new Error(result.error || "Unable to delete application.");
      }

      setApplicationList((current) => current.filter((application) => application.id !== id));

      if (applicationId === id) {
        const storageKey = getApplicationStorageKey(authUser.id);
        window.localStorage.removeItem(`${storageKey}.id`);
        window.localStorage.removeItem(storageKey);
        setSelectedDocumentIds([]);
        setBrief(defaultBrief);
        setDraft(defaultDraft);
        setEditedContent(plainTextToHtml(defaultDraft.content));
        setApplicationId(null);
        setGenerationStatus("idle");
        setSyncStatus("idle");
      }

      setStatusMessage("Application deleted.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to delete application.");
    }
  }

  if (!authChecked) {
    return (
      <section className="surface-panel mx-auto max-w-xl rounded-[2rem] p-8">
        <p className="eyebrow">ApplyRocket.AI</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-heading">Loading your secure application...</h1>
        <p className="mt-3 text-sm leading-6 text-body">Checking your session and restoring the applications that belong to your account.</p>
      </section>
    );
  }

  if (!authUser) {
    return (
      <section className="surface-panel mx-auto max-w-xl rounded-[2rem] p-8">
        <p className="eyebrow">ApplyRocket.AI</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-heading">Secure sign-in for your saved applications</h1>
        <p className="mt-3 text-sm leading-6 text-body">
          Your account now protects saved drafts and application recovery. Passwords are stored as one-way hashes, never plain text.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button className={`secondary-button ${authMode === "login" ? "is-active" : ""}`} onClick={() => setAuthMode("login")} type="button">
            Sign in
          </button>
          <button className={`secondary-button ${authMode === "register" ? "is-active" : ""}`} onClick={() => setAuthMode("register")} type="button">
            Create account
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={submitAuthForm}>
          <Field label="Email address">
            <input autoComplete="email" type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="Password">
            <input
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
              type="password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              placeholder="At least 8 characters"
            />
          </Field>
          <button className="primary-button w-full" disabled={authPending} type="submit">
            {authPending ? (authMode === "login" ? "Signing in..." : "Creating account...") : authMode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-sm text-body">{authMessage}</p>
      </section>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section className="surface-panel space-y-6 rounded-[2rem] p-6">
        <div>
          <p className="eyebrow">ApplyRocket.AI</p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-body">Your documents</h2>
            <span className="text-xs text-faint">{selectedDocumentIds.length}/{MAX_DOCUMENTS_PER_APPLICATION} attached</span>
          </div>
          {documentLibrary.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {documentLibrary.map((document) => {
                const isSelected = selectedDocumentIds.includes(document.id);
                return (
                  <div
                    key={document.id}
                    className={`group flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2 text-xs ${isSelected ? "border-accent-soft bg-accent-soft" : "surface-inset"}`}
                    title={isSelected ? "Attached to this application. Click to detach." : "Click to attach to this application."}
                  >
                    <button
                      className="flex items-center gap-1.5"
                      onClick={() => toggleDocumentSelection(document.id)}
                      type="button"
                    >
                      <DocumentIcon />
                      <span className="max-w-[9rem] truncate">{document.name}</span>
                    </button>
                    <button
                      aria-label={`Delete ${document.name}`}
                      className="text-faint hover:text-danger"
                      onClick={() => deleteFromLibrary(document.id)}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">No documents yet. Upload your CV below to get started.</p>
          )}
        </div>

        <label
          className={`upload-zone surface-sunken block cursor-pointer rounded-3xl border border-dashed p-5 transition ${isDraggingOver ? "border-accent-soft bg-accent-soft" : ""}`}
          onDragLeave={handleUploadDragLeave}
          onDragOver={handleUploadDragOver}
          onDrop={handleUploadDrop}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-heading">Upload CV and supporting files</p>
              <p className="mt-1 text-xs text-muted">Drag and drop, or browse. Saved to your document library and attached to this application.</p>
            </div>
            <span className="bg-accent-soft rounded-full px-3 py-1 text-xs font-medium">Browse</span>
          </div>
          <input className="sr-only" multiple type="file" onChange={handleUpload} />
        </label>
        <p className="text-xs leading-5 text-muted">{getUploadLimitMessage()}</p>
        {uploadError ? <p className="danger-banner rounded-2xl p-4 text-sm">{uploadError}</p> : null}

        <div className="space-y-4">
          <Field label="Target role">
            <input value={brief.role} onChange={(event) => setBrief((current) => ({ ...current, role: event.target.value }))} placeholder="Senior Product Manager" />
          </Field>
          <Field label="Company">
            <input value={brief.company} onChange={(event) => setBrief((current) => ({ ...current, company: event.target.value }))} placeholder="ApplyRocket" />
          </Field>
          <Field label="Location">
            <input value={brief.location} onChange={(event) => setBrief((current) => ({ ...current, location: event.target.value }))} placeholder="Remote" />
          </Field>
          <Field label="Tone">
            <select value={brief.tone} onChange={(event) => setBrief((current) => ({ ...current, tone: event.target.value as JobBrief["tone"] }))}>
              <option value="formal">Formal</option>
              <option value="confident">Confident</option>
              <option value="warm">Warm</option>
              <option value="direct">Direct</option>
            </select>
          </Field>
          <Field label="Job description">
            <textarea rows={7} value={brief.description} onChange={(event) => setBrief((current) => ({ ...current, description: event.target.value }))} placeholder="Paste the job posting or a working summary here." />
          </Field>
        </div>

        <div className="surface-inset rounded-3xl border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-heading">Saved applications</p>
              <p className="text-xs text-muted">Server-backed recovery for the applications attached to your account.</p>
            </div>
            <button className="secondary-button text-xs" type="button" onClick={createApplication}>
              Save as new
            </button>
          </div>

          <div className="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
            {applicationList.length ? (
              applicationList.map((application) => (
                <div key={application.id} className="application-row surface-sunken flex items-center gap-2 rounded-2xl border px-4 py-3 text-left text-sm text-body">
                  <button className="flex-1 text-left" onClick={() => loadApplication(application.id)} type="button">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-heading">{application.brief.company || "Untitled application"}</span>
                      <span className="text-[11px] uppercase tracking-[0.2em] text-faint">{application.id.slice(0, 8)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{application.brief.role}</p>
                  </button>
                  <button
                    aria-label={`Delete application for ${application.brief.company || application.brief.role}`}
                    className="text-xs text-muted hover:text-danger"
                    onClick={() => deleteApplication(application.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))
            ) : (
              <p className="border-subtle rounded-2xl border border-dashed p-3 text-xs text-muted">No saved applications yet. Click save to create one.</p>
            )}
          </div>
        </div>

        <button className="primary-button w-full" disabled={!canGenerate || generationStatus === "loading"} onClick={generateDraft} type="button">
          {generationStatus === "loading" ? "Generating..." : "Generate cover letter"}
        </button>

        <div className="grid gap-3 sm:grid-cols-2">
          <button className="secondary-button w-full" onClick={regenerateFromCurrentDraft} type="button">
            Refresh draft metadata
          </button>
          <button className="secondary-button w-full" onClick={resetApplication} type="button">
            Reset application
          </button>
          <button className="secondary-button w-full sm:col-span-2" onClick={exportApplication} type="button">
            Export application JSON
          </button>
        </div>

        <p className={`text-sm ${generationStatus === "error" ? "text-danger" : "text-muted"}`}>{statusMessage}</p>
      </section>

      <section className="surface-panel flex min-h-[760px] flex-col rounded-[2rem] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Editable draft</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-heading">{draft.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-body">{draft.summary}</p>
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

        <div className="surface-sunken mt-6 flex-1 rounded-[1.75rem] border p-4">
          <RichTextEditor value={editedContent} onChange={setEditedContent} />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{providerLabel(draft.provider)}</span>
          <span>{hasHydrated && draft.generatedAt ? `Last generated ${new Date(draft.generatedAt).toLocaleString()}` : "Last generated -"}</span>
          <span>Sync: {syncStatus}</span>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">{label}</span>
      {children}
    </label>
  );
}

function DocumentIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
