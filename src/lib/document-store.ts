import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./database";
import type { DocumentKind, DocumentRecord, NewDocumentInput, StoredDocumentRecord } from "./types";

export class DocumentAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentAccessError";
  }
}

function toDocumentRecord(record: StoredDocumentRecord): DocumentRecord {
  const { ownerId: _ownerId, ...documentRecord } = record;
  return documentRecord;
}

function mapDocumentRow(row: Record<string, unknown> | undefined): StoredDocumentRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    kind: String(row.kind) as DocumentKind,
    type: String(row.type),
    size: Number(row.size),
    extractedText: String(row.extracted_text),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function readStoredDocumentRecord(database: DatabaseSync, id: string): StoredDocumentRecord | null {
  const row = database.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return mapDocumentRow(row);
}

export async function migrateDocumentOwner(fromOwnerId: string, toOwnerId: string): Promise<number> {
  if (fromOwnerId === toOwnerId) {
    return 0;
  }

  const database = getDatabase();
  const result = database.prepare("UPDATE documents SET owner_id = ? WHERE owner_id = ?").run(toOwnerId, fromOwnerId) as { changes?: number };
  return result.changes ?? 0;
}

export async function listDocumentRecords(ownerId: string): Promise<DocumentRecord[]> {
  const database = getDatabase();
  const rows = database.prepare("SELECT * FROM documents WHERE owner_id = ? ORDER BY created_at DESC").all(ownerId) as Array<Record<string, unknown>>;

  return rows
    .map((row) => mapDocumentRow(row))
    .filter((record): record is StoredDocumentRecord => record !== null)
    .map(toDocumentRecord);
}

export async function readDocumentRecord(id: string, ownerId: string): Promise<DocumentRecord | null> {
  const database = getDatabase();
  const record = readStoredDocumentRecord(database, id);
  if (!record || record.ownerId !== ownerId) {
    return null;
  }

  return toDocumentRecord(record);
}

/** Resolves a list of document ids to the subset owned by `ownerId`, silently dropping unknown or foreign ids. */
export async function readDocumentRecords(ids: string[], ownerId: string): Promise<DocumentRecord[]> {
  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) {
    return [];
  }

  const database = getDatabase();
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = database
    .prepare(`SELECT * FROM documents WHERE owner_id = ? AND id IN (${placeholders})`)
    .all(ownerId, ...uniqueIds) as Array<Record<string, unknown>>;

  return rows
    .map((row) => mapDocumentRow(row))
    .filter((record): record is StoredDocumentRecord => record !== null)
    .map(toDocumentRecord);
}

export async function createDocumentRecord(id: string, input: NewDocumentInput, ownerId: string): Promise<DocumentRecord> {
  const database = getDatabase();
  const now = new Date().toISOString();

  database
    .prepare(`
      INSERT INTO documents (id, owner_id, name, kind, type, size, extracted_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(id, ownerId, input.name, input.kind, input.type, input.size, input.extractedText, now, now);

  return {
    id,
    name: input.name,
    kind: input.kind,
    type: input.type,
    size: input.size,
    extractedText: input.extractedText,
    createdAt: now,
    updatedAt: now
  };
}

export async function deleteDocumentRecord(id: string, ownerId: string): Promise<boolean> {
  const database = getDatabase();
  const result = database.prepare("DELETE FROM documents WHERE id = ? AND owner_id = ?").run(id, ownerId) as { changes?: number };
  return (result.changes ?? 0) > 0;
}
