import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDatabaseForTests } from "./database";
import { createDocumentRecord, deleteDocumentRecord, listDocumentRecords, migrateDocumentOwner, readDocumentRecord, readDocumentRecords } from "./document-store";

describe("document store ownership", () => {
  let tempDir: string;
  const previousDatabasePath = process.env.DATABASE_PATH;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "applyrocket-documents-"));
    process.env.DATABASE_PATH = path.join(tempDir, "app.db");
    resetDatabaseForTests();
  });

  afterEach(async () => {
    resetDatabaseForTests();

    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("only lists documents for the matching owner", async () => {
    await createDocumentRecord("doc-a", { name: "cv.pdf", kind: "cv", type: "application/pdf", size: 10, extractedText: "A" }, "owner-a");
    await createDocumentRecord("doc-b", { name: "cover.pdf", kind: "attachment", type: "application/pdf", size: 20, extractedText: "B" }, "owner-b");

    await expect(listDocumentRecords("owner-a")).resolves.toHaveLength(1);
    await expect(listDocumentRecords("owner-b")).resolves.toHaveLength(1);
  });

  it("blocks reading a document that belongs to another owner", async () => {
    await createDocumentRecord("doc-a", { name: "cv.pdf", kind: "cv", type: "application/pdf", size: 10, extractedText: "A" }, "owner-a");

    await expect(readDocumentRecord("doc-a", "owner-b")).resolves.toBeNull();
    await expect(readDocumentRecord("doc-a", "owner-a")).resolves.toMatchObject({ id: "doc-a" });
  });

  it("resolves only the ids owned by the requester, dropping unknown or foreign ids", async () => {
    await createDocumentRecord("doc-a", { name: "cv.pdf", kind: "cv", type: "application/pdf", size: 10, extractedText: "A" }, "owner-a");
    await createDocumentRecord("doc-b", { name: "cover.pdf", kind: "attachment", type: "application/pdf", size: 20, extractedText: "B" }, "owner-b");

    const resolved = await readDocumentRecords(["doc-a", "doc-b", "missing"], "owner-a");

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe("doc-a");
  });

  it("only deletes documents for the matching owner", async () => {
    await createDocumentRecord("doc-a", { name: "cv.pdf", kind: "cv", type: "application/pdf", size: 10, extractedText: "A" }, "owner-a");

    await expect(deleteDocumentRecord("doc-a", "owner-b")).resolves.toBe(false);
    await expect(deleteDocumentRecord("doc-a", "owner-a")).resolves.toBe(true);
  });

  it("does not expose owner identifiers in returned document records", async () => {
    const record = await createDocumentRecord("doc-a", { name: "cv.pdf", kind: "cv", type: "application/pdf", size: 10, extractedText: "A" }, "owner-a");

    expect(record).not.toHaveProperty("ownerId");
  });

  it("migrates legacy owner documents to the authenticated user", async () => {
    await createDocumentRecord("doc-a", { name: "cv.pdf", kind: "cv", type: "application/pdf", size: 10, extractedText: "A" }, "legacy-owner");
    await createDocumentRecord("doc-b", { name: "cover.pdf", kind: "attachment", type: "application/pdf", size: 20, extractedText: "B" }, "legacy-owner");

    await expect(migrateDocumentOwner("legacy-owner", "user-123")).resolves.toBe(2);
    await expect(listDocumentRecords("legacy-owner")).resolves.toHaveLength(0);
    await expect(listDocumentRecords("user-123")).resolves.toHaveLength(2);
  });
});
