import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
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
  const previousDataDir = process.env.WORKSPACE_DATA_DIR;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "applyrocket-workspaces-"));
    process.env.WORKSPACE_DATA_DIR = tempDir;
  });

  afterEach(async () => {
    if (previousDataDir === undefined) {
      delete process.env.WORKSPACE_DATA_DIR;
    } else {
      process.env.WORKSPACE_DATA_DIR = previousDataDir;
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
});
