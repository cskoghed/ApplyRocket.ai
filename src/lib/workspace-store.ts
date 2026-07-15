import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceRecord, WorkspaceSnapshot } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "workspaces");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function workspacePath(id: string) {
  return path.join(DATA_DIR, `${id}.json`);
}

export async function listWorkspaceRecords(): Promise<WorkspaceRecord[]> {
  await ensureDataDir();

  const fileNames = await fs.readdir(DATA_DIR);
  const records = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith(".json"))
      .map(async (fileName) => {
        const fileContent = await fs.readFile(path.join(DATA_DIR, fileName), "utf8");
        return JSON.parse(fileContent) as WorkspaceRecord;
      })
  );

  return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readWorkspaceRecord(id: string): Promise<WorkspaceRecord | null> {
  await ensureDataDir();

  try {
    const fileContent = await fs.readFile(workspacePath(id), "utf8");
    return JSON.parse(fileContent) as WorkspaceRecord;
  } catch {
    return null;
  }
}

export async function saveWorkspaceRecord(id: string, snapshot: WorkspaceSnapshot): Promise<WorkspaceRecord> {
  await ensureDataDir();

  const existing = await readWorkspaceRecord(id);
  const now = new Date().toISOString();
  const record: WorkspaceRecord = {
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...snapshot
  };

  await fs.writeFile(workspacePath(id), JSON.stringify(record, null, 2), "utf8");
  return record;
}

export async function deleteWorkspaceRecord(id: string): Promise<boolean> {
  await ensureDataDir();

  try {
    await fs.unlink(workspacePath(id));
    return true;
  } catch {
    return false;
  }
}
