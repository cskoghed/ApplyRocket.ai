import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDatabase, resetDatabaseForTests } from "./database";
import type { WorkspaceSnapshot } from "./types";
import { deleteWorkspaceRecord, listWorkspaceRecords, migrateWorkspaceOwner, readWorkspaceRecord, saveWorkspaceRecord, WorkspaceAccessError } from "./workspace-store";

const snapshot: WorkspaceSnapshot = {
  brief: {
    role: "Designer",
    company: "Orbit",
    location: "Remote",
    tone: "warm",
    description: "Build better workflows."
  },
  draft: {
    title: "Designer cover letter",
    content: "Hello",
    summary: "Summary",
    bullets: ["One", "Two", "Three"],
    provider: "template",
    generatedAt: ""
  },
  documents: [],
  editedContent: "Hello"
};

describe("workspace store ownership", () => {
  let tempDir: string;
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousWorkspaceDataDir = process.env.WORKSPACE_DATA_DIR;
  const previousAuthDataDir = process.env.AUTH_DATA_DIR;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "applyrocket-workspaces-"));
    process.env.DATABASE_PATH = path.join(tempDir, "app.db");
    process.env.WORKSPACE_DATA_DIR = path.join(tempDir, "legacy-workspaces");
    process.env.AUTH_DATA_DIR = path.join(tempDir, "legacy-auth");
    resetDatabaseForTests();
  });

  afterEach(async () => {
    resetDatabaseForTests();

    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }

    if (previousWorkspaceDataDir === undefined) {
      delete process.env.WORKSPACE_DATA_DIR;
    } else {
      process.env.WORKSPACE_DATA_DIR = previousWorkspaceDataDir;
    }

    if (previousAuthDataDir === undefined) {
      delete process.env.AUTH_DATA_DIR;
    } else {
      process.env.AUTH_DATA_DIR = previousAuthDataDir;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("only lists workspaces for the matching owner", async () => {
    await saveWorkspaceRecord("workspace-a", snapshot, "owner-a");
    await saveWorkspaceRecord("workspace-b", snapshot, "owner-b");

    const ownerAWorkspaces = await listWorkspaceRecords("owner-a");
    const ownerBWorkspaces = await listWorkspaceRecords("owner-b");

    expect(ownerAWorkspaces).toHaveLength(1);
    expect(ownerAWorkspaces[0]?.id).toBe("workspace-a");
    expect(ownerBWorkspaces).toHaveLength(1);
    expect(ownerBWorkspaces[0]?.id).toBe("workspace-b");
  });

  it("blocks reading a workspace that belongs to another owner", async () => {
    await saveWorkspaceRecord("workspace-a", snapshot, "owner-a");

    const record = await readWorkspaceRecord("workspace-a", "owner-b");

    expect(record).toBeNull();
  });

  it("blocks updating a workspace that belongs to another owner", async () => {
    await saveWorkspaceRecord("workspace-a", snapshot, "owner-a");

    await expect(saveWorkspaceRecord("workspace-a", snapshot, "owner-b")).rejects.toThrow(WorkspaceAccessError);
  });

  it("migrates legacy owner workspaces to the authenticated user", async () => {
    await saveWorkspaceRecord("workspace-a", snapshot, "legacy-owner");
    await saveWorkspaceRecord("workspace-b", snapshot, "legacy-owner");

    await expect(migrateWorkspaceOwner("legacy-owner", "user-123")).resolves.toBe(2);
    await expect(listWorkspaceRecords("legacy-owner")).resolves.toHaveLength(0);
    await expect(listWorkspaceRecords("user-123")).resolves.toHaveLength(2);
  });

  it("does not expose owner identifiers in returned workspace records", async () => {
    const record = await saveWorkspaceRecord("workspace-a", snapshot, "owner-a");

    expect(record).not.toHaveProperty("ownerId");
  });

  it("only deletes workspaces for the matching owner", async () => {
    await saveWorkspaceRecord("workspace-a", snapshot, "owner-a");

    await expect(deleteWorkspaceRecord("workspace-a", "owner-b")).resolves.toBe(false);
    await expect(deleteWorkspaceRecord("workspace-a", "owner-a")).resolves.toBe(true);
  });

  it("migrates legacy json workspaces into sqlite", async () => {
    const legacyWorkspaceDir = process.env.WORKSPACE_DATA_DIR!;
    await fs.mkdir(legacyWorkspaceDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyWorkspaceDir, "workspace-1.json"),
      JSON.stringify({
        id: "workspace-1",
        ownerId: "owner-a",
        brief: snapshot.brief,
        draft: snapshot.draft,
        documents: snapshot.documents,
        editedContent: snapshot.editedContent,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }),
      "utf8"
    );

    resetDatabaseForTests();
    const database = getDatabase();
    const row = database.prepare("SELECT owner_id, edited_content FROM workspaces WHERE id = ?").get("workspace-1") as Record<string, unknown>;

    expect(String(row.owner_id)).toBe("owner-a");
    expect(String(row.edited_content)).toBe("Hello");
  });
});
