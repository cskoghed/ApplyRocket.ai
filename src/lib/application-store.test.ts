import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationAccessError, deleteApplicationRecord, listApplicationRecords, migrateApplicationOwner, readApplicationRecord, saveApplicationRecord } from "./application-store";
import { getDatabase, resetDatabaseForTests } from "./database";
import type { ApplicationSnapshot } from "./types";

const snapshot: ApplicationSnapshot = {
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
  documentIds: [],
  editedContent: "Hello"
};

describe("application store ownership", () => {
  let tempDir: string;
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousApplicationDataDir = process.env.APPLICATION_DATA_DIR;
  const previousAuthDataDir = process.env.AUTH_DATA_DIR;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "applyrocket-applications-"));
    process.env.DATABASE_PATH = path.join(tempDir, "app.db");
    process.env.APPLICATION_DATA_DIR = path.join(tempDir, "legacy-applications");
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

    if (previousApplicationDataDir === undefined) {
      delete process.env.APPLICATION_DATA_DIR;
    } else {
      process.env.APPLICATION_DATA_DIR = previousApplicationDataDir;
    }

    if (previousAuthDataDir === undefined) {
      delete process.env.AUTH_DATA_DIR;
    } else {
      process.env.AUTH_DATA_DIR = previousAuthDataDir;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("only lists applications for the matching owner", async () => {
    await saveApplicationRecord("application-a", snapshot, "owner-a");
    await saveApplicationRecord("application-b", snapshot, "owner-b");

    const ownerAApplications = await listApplicationRecords("owner-a");
    const ownerBApplications = await listApplicationRecords("owner-b");

    expect(ownerAApplications).toHaveLength(1);
    expect(ownerAApplications[0]?.id).toBe("application-a");
    expect(ownerBApplications).toHaveLength(1);
    expect(ownerBApplications[0]?.id).toBe("application-b");
  });

  it("blocks reading an application that belongs to another owner", async () => {
    await saveApplicationRecord("application-a", snapshot, "owner-a");

    const record = await readApplicationRecord("application-a", "owner-b");

    expect(record).toBeNull();
  });

  it("blocks updating an application that belongs to another owner", async () => {
    await saveApplicationRecord("application-a", snapshot, "owner-a");

    await expect(saveApplicationRecord("application-a", snapshot, "owner-b")).rejects.toThrow(ApplicationAccessError);
  });

  it("migrates legacy owner applications to the authenticated user", async () => {
    await saveApplicationRecord("application-a", snapshot, "legacy-owner");
    await saveApplicationRecord("application-b", snapshot, "legacy-owner");

    await expect(migrateApplicationOwner("legacy-owner", "user-123")).resolves.toBe(2);
    await expect(listApplicationRecords("legacy-owner")).resolves.toHaveLength(0);
    await expect(listApplicationRecords("user-123")).resolves.toHaveLength(2);
  });

  it("does not expose owner identifiers in returned application records", async () => {
    const record = await saveApplicationRecord("application-a", snapshot, "owner-a");

    expect(record).not.toHaveProperty("ownerId");
  });

  it("only deletes applications for the matching owner", async () => {
    await saveApplicationRecord("application-a", snapshot, "owner-a");

    await expect(deleteApplicationRecord("application-a", "owner-b")).resolves.toBe(false);
    await expect(deleteApplicationRecord("application-a", "owner-a")).resolves.toBe(true);
  });

  it("migrates legacy json applications into sqlite", async () => {
    const legacyApplicationDir = process.env.APPLICATION_DATA_DIR!;
    await fs.mkdir(legacyApplicationDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyApplicationDir, "application-1.json"),
      JSON.stringify({
        id: "application-1",
        ownerId: "owner-a",
        brief: snapshot.brief,
        draft: snapshot.draft,
        documents: [
          {
            id: "document-1",
            name: "cv.pdf",
            kind: "cv",
            type: "application/pdf",
            size: 128,
            extractedText: "Experienced engineer."
          }
        ],
        editedContent: snapshot.editedContent,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }),
      "utf8"
    );

    resetDatabaseForTests();
    const database = getDatabase();
    const applicationRow = database.prepare("SELECT owner_id, edited_content, document_ids_json FROM applications WHERE id = ?").get("application-1") as Record<string, unknown>;
    const documentRow = database.prepare("SELECT owner_id, name FROM documents WHERE id = ?").get("document-1") as Record<string, unknown>;

    expect(String(applicationRow.owner_id)).toBe("owner-a");
    expect(String(applicationRow.edited_content)).toBe("Hello");
    expect(JSON.parse(String(applicationRow.document_ids_json))).toEqual(["document-1"]);
    expect(String(documentRow.owner_id)).toBe("owner-a");
    expect(String(documentRow.name)).toBe("cv.pdf");
  });
});
