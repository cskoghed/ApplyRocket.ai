import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./database";
import type { ApplicationRecord, ApplicationSnapshot, StoredApplicationRecord } from "./types";

export class ApplicationAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationAccessError";
  }
}

function toApplicationRecord(record: StoredApplicationRecord): ApplicationRecord {
  const { ownerId: _ownerId, ...applicationRecord } = record;
  return applicationRecord;
}

function mapApplicationRow(row: Record<string, unknown> | undefined): StoredApplicationRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    ownerId: row.owner_id == null ? undefined : String(row.owner_id),
    brief: JSON.parse(String(row.brief_json)) as ApplicationSnapshot["brief"],
    draft: JSON.parse(String(row.draft_json)) as ApplicationSnapshot["draft"],
    documentIds: JSON.parse(String(row.document_ids_json)) as ApplicationSnapshot["documentIds"],
    editedContent: String(row.edited_content),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function readStoredApplicationRecord(database: DatabaseSync, id: string): StoredApplicationRecord | null {
  const row = database.prepare("SELECT * FROM applications WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return mapApplicationRow(row);
}

export async function migrateApplicationOwner(fromOwnerId: string, toOwnerId: string): Promise<number> {
  if (fromOwnerId === toOwnerId) {
    return 0;
  }

  const database = getDatabase();
  const result = database.prepare("UPDATE applications SET owner_id = ? WHERE owner_id = ?").run(toOwnerId, fromOwnerId) as { changes?: number };
  return result.changes ?? 0;
}

export async function listApplicationRecords(ownerId: string): Promise<ApplicationRecord[]> {
  const database = getDatabase();
  const rows = database.prepare("SELECT * FROM applications WHERE owner_id = ? ORDER BY updated_at DESC").all(ownerId) as Array<Record<string, unknown>>;

  return rows
    .map((row) => mapApplicationRow(row))
    .filter((record): record is StoredApplicationRecord => record !== null)
    .map(toApplicationRecord);
}

export async function readApplicationRecord(id: string, ownerId: string): Promise<ApplicationRecord | null> {
  const database = getDatabase();
  const existingRecord = readStoredApplicationRecord(database, id);
  if (!existingRecord || existingRecord.ownerId !== ownerId) {
    return null;
  }

  return toApplicationRecord(existingRecord);
}

export async function saveApplicationRecord(id: string, snapshot: ApplicationSnapshot, ownerId: string): Promise<ApplicationRecord> {
  const database = getDatabase();
  const existingRecord = readStoredApplicationRecord(database, id);
  const now = new Date().toISOString();

  if (existingRecord && existingRecord.ownerId !== ownerId) {
    throw new ApplicationAccessError("Application not found.");
  }

  database.prepare(`
    INSERT INTO applications (id, owner_id, brief_json, draft_json, document_ids_json, edited_content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      owner_id = excluded.owner_id,
      brief_json = excluded.brief_json,
      draft_json = excluded.draft_json,
      document_ids_json = excluded.document_ids_json,
      edited_content = excluded.edited_content,
      updated_at = excluded.updated_at
  `).run(
    id,
    ownerId,
    JSON.stringify(snapshot.brief),
    JSON.stringify(snapshot.draft),
    JSON.stringify(snapshot.documentIds),
    snapshot.editedContent,
    existingRecord?.createdAt ?? now,
    now
  );

  return {
    id,
    brief: snapshot.brief,
    draft: snapshot.draft,
    documentIds: snapshot.documentIds,
    editedContent: snapshot.editedContent,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now
  };
}

export async function deleteApplicationRecord(id: string, ownerId: string): Promise<boolean> {
  const database = getDatabase();
  const result = database.prepare("DELETE FROM applications WHERE id = ? AND owner_id = ?").run(id, ownerId) as { changes?: number };
  return (result.changes ?? 0) > 0;
}
