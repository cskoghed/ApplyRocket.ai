import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./database";
import type { StoredWorkspaceRecord, WorkspaceRecord, WorkspaceSnapshot } from "./types";

export class WorkspaceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

function toWorkspaceRecord(record: StoredWorkspaceRecord): WorkspaceRecord {
  const { ownerId: _ownerId, ...workspaceRecord } = record;
  return workspaceRecord;
}

function mapWorkspaceRow(row: Record<string, unknown> | undefined): StoredWorkspaceRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    ownerId: row.owner_id == null ? undefined : String(row.owner_id),
    brief: JSON.parse(String(row.brief_json)) as WorkspaceSnapshot["brief"],
    draft: JSON.parse(String(row.draft_json)) as WorkspaceSnapshot["draft"],
    documents: JSON.parse(String(row.documents_json)) as WorkspaceSnapshot["documents"],
    editedContent: String(row.edited_content),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function readStoredWorkspaceRecord(database: DatabaseSync, id: string): StoredWorkspaceRecord | null {
  const row = database.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return mapWorkspaceRow(row);
}

export async function migrateWorkspaceOwner(fromOwnerId: string, toOwnerId: string): Promise<number> {
  if (fromOwnerId === toOwnerId) {
    return 0;
  }

  const database = getDatabase();
  const result = database.prepare("UPDATE workspaces SET owner_id = ? WHERE owner_id = ?").run(toOwnerId, fromOwnerId) as { changes?: number };
  return result.changes ?? 0;
}

export async function listWorkspaceRecords(ownerId: string): Promise<WorkspaceRecord[]> {
  const database = getDatabase();
  const rows = database.prepare("SELECT * FROM workspaces WHERE owner_id = ? ORDER BY updated_at DESC").all(ownerId) as Array<Record<string, unknown>>;

  return rows
    .map((row) => mapWorkspaceRow(row))
    .filter((record): record is StoredWorkspaceRecord => record !== null)
    .map(toWorkspaceRecord);
}

export async function readWorkspaceRecord(id: string, ownerId: string): Promise<WorkspaceRecord | null> {
  const database = getDatabase();
  const existingRecord = readStoredWorkspaceRecord(database, id);
  if (!existingRecord || existingRecord.ownerId !== ownerId) {
    return null;
  }

  return toWorkspaceRecord(existingRecord);
}

export async function saveWorkspaceRecord(id: string, snapshot: WorkspaceSnapshot, ownerId: string): Promise<WorkspaceRecord> {
  const database = getDatabase();
  const existingRecord = readStoredWorkspaceRecord(database, id);
  const now = new Date().toISOString();

  if (existingRecord && existingRecord.ownerId !== ownerId) {
    throw new WorkspaceAccessError("Workspace not found.");
  }

  database.prepare(`
    INSERT INTO workspaces (id, owner_id, brief_json, draft_json, documents_json, edited_content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      owner_id = excluded.owner_id,
      brief_json = excluded.brief_json,
      draft_json = excluded.draft_json,
      documents_json = excluded.documents_json,
      edited_content = excluded.edited_content,
      updated_at = excluded.updated_at
  `).run(
    id,
    ownerId,
    JSON.stringify(snapshot.brief),
    JSON.stringify(snapshot.draft),
    JSON.stringify(snapshot.documents),
    snapshot.editedContent,
    existingRecord?.createdAt ?? now,
    now
  );

  return {
    id,
    brief: snapshot.brief,
    draft: snapshot.draft,
    documents: snapshot.documents,
    editedContent: snapshot.editedContent,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now
  };
}

export async function deleteWorkspaceRecord(id: string, ownerId: string): Promise<boolean> {
  const database = getDatabase();
  const result = database.prepare("DELETE FROM workspaces WHERE id = ? AND owner_id = ?").run(id, ownerId) as { changes?: number };
  return (result.changes ?? 0) > 0;
}
