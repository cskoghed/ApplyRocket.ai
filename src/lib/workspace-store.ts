import { promises as fs } from "node:fs";
import path from "node:path";
import type { StoredWorkspaceRecord, WorkspaceRecord, WorkspaceSnapshot } from "./types";

export class WorkspaceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

function getDataDir() {
  const configuredDataDir = process.env.WORKSPACE_DATA_DIR;
  return configuredDataDir ? path.resolve(configuredDataDir) : path.join(process.cwd(), "data", "workspaces");
}

async function ensureDataDir() {
  await fs.mkdir(getDataDir(), { recursive: true });
}

function workspacePath(id: string) {
  return path.join(getDataDir(), `${id}.json`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function toWorkspaceRecord(record: StoredWorkspaceRecord): WorkspaceRecord {
  const { ownerId: _ownerId, ...workspaceRecord } = record;
  return workspaceRecord;
}

async function readStoredWorkspaceRecord(id: string): Promise<StoredWorkspaceRecord | null> {
  try {
    const fileContent = await fs.readFile(workspacePath(id), "utf8");
    return JSON.parse(fileContent) as StoredWorkspaceRecord;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeStoredWorkspaceRecord(id: string, record: StoredWorkspaceRecord) {
  await fs.writeFile(workspacePath(id), JSON.stringify(record, null, 2), "utf8");
}

export async function migrateWorkspaceOwner(fromOwnerId: string, toOwnerId: string): Promise<number> {
  await ensureDataDir();

  if (fromOwnerId === toOwnerId) {
    return 0;
  }

  const fileNames = await fs.readdir(getDataDir());
  let migratedCount = 0;

  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(getDataDir(), fileName);
    const fileContent = await fs.readFile(filePath, "utf8");
    const record = JSON.parse(fileContent) as StoredWorkspaceRecord;

    if (record.ownerId !== fromOwnerId) {
      continue;
    }

    await fs.writeFile(filePath, JSON.stringify({ ...record, ownerId: toOwnerId }, null, 2), "utf8");
    migratedCount += 1;
  }

  return migratedCount;
}

export async function listWorkspaceRecords(ownerId: string): Promise<WorkspaceRecord[]> {
  await ensureDataDir();

  const fileNames = await fs.readdir(getDataDir());
  const records = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith(".json"))
      .map(async (fileName) => {
        const fileContent = await fs.readFile(path.join(getDataDir(), fileName), "utf8");
        return JSON.parse(fileContent) as StoredWorkspaceRecord;
      })
  );

  return records
    .filter((record) => record.ownerId === ownerId)
    .map(toWorkspaceRecord)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readWorkspaceRecord(id: string, ownerId: string): Promise<WorkspaceRecord | null> {
  await ensureDataDir();

  const existingRecord = await readStoredWorkspaceRecord(id);
  if (!existingRecord || existingRecord.ownerId !== ownerId) {
    return null;
  }

  return toWorkspaceRecord(existingRecord);
}

export async function saveWorkspaceRecord(id: string, snapshot: WorkspaceSnapshot, ownerId: string): Promise<WorkspaceRecord> {
  await ensureDataDir();

  const existingRecord = await readStoredWorkspaceRecord(id);
  const now = new Date().toISOString();

  if (existingRecord && existingRecord.ownerId !== ownerId) {
    throw new WorkspaceAccessError("Workspace not found.");
  }

  const record: StoredWorkspaceRecord = {
    id,
    ownerId,
    createdAt: existingRecord?.createdAt ?? now,
    updatedAt: now,
    ...snapshot
  };

  await writeStoredWorkspaceRecord(id, record);
  return toWorkspaceRecord(record);
}

export async function deleteWorkspaceRecord(id: string, ownerId: string): Promise<boolean> {
  await ensureDataDir();

  const existingRecord = await readStoredWorkspaceRecord(id);
  if (!existingRecord || existingRecord.ownerId !== ownerId) {
    return false;
  }

  await fs.unlink(workspacePath(id));
  return true;
}
