import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { StoredWorkspaceRecord } from "./types";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type NodeSqliteDatabase = import("node:sqlite").DatabaseSync;

type StoredUserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
};

type StoredSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

type DatabaseCache = {
  databasePath: string;
  database: NodeSqliteDatabase;
};

declare global {
  // eslint-disable-next-line no-var
  var __applyRocketDatabaseCache: DatabaseCache | undefined;
}

function getDatabasePath() {
  const configuredPath = process.env.DATABASE_PATH;
  return configuredPath ? path.resolve(configuredPath) : path.join(process.cwd(), "data", "applyrocket.db");
}

function ensureDatabaseDir(databasePath: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
}

function getLegacyAuthDir() {
  const configuredDataDir = process.env.AUTH_DATA_DIR;
  return configuredDataDir ? path.resolve(configuredDataDir) : path.join(process.cwd(), "data", "auth");
}

function getLegacyWorkspaceDir() {
  const configuredDataDir = process.env.WORKSPACE_DATA_DIR;
  return configuredDataDir ? path.resolve(configuredDataDir) : path.join(process.cwd(), "data", "workspaces");
}

function parseJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function listJsonFiles(dirPath: string): string[] {
  try {
    return readdirSync(dirPath)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => path.join(dirPath, fileName));
  } catch {
    return [];
  }
}

function ensureSchema(database: NodeSqliteDatabase) {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      brief_json TEXT NOT NULL,
      draft_json TEXT NOT NULL,
      documents_json TEXT NOT NULL,
      edited_content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON workspaces(owner_id);
    CREATE INDEX IF NOT EXISTS idx_workspaces_updated_at ON workspaces(updated_at DESC);
  `);
}

function migrateJsonStorage(database: NodeSqliteDatabase) {
  const migrationState = database.prepare("SELECT value FROM metadata WHERE key = ?").get("json_storage_migrated") as { value: string } | undefined;
  if (migrationState?.value === "1") {
    return;
  }

  const insertUser = database.prepare(`
    INSERT OR IGNORE INTO users (id, email, password_hash, password_salt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertSession = database.prepare(`
    INSERT OR IGNORE INTO sessions (id, user_id, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertWorkspace = database.prepare(`
    INSERT OR IGNORE INTO workspaces (id, owner_id, brief_json, draft_json, documents_json, edited_content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const setMigrationState = database.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)");

  database.exec("BEGIN");
  try {
    for (const filePath of listJsonFiles(path.join(getLegacyAuthDir(), "users"))) {
      const record = parseJsonFile<StoredUserRecord>(filePath);
      if (!record) {
        continue;
      }

      insertUser.run(record.id, record.email, record.passwordHash, record.passwordSalt, record.createdAt, record.updatedAt);
    }

    for (const filePath of listJsonFiles(path.join(getLegacyAuthDir(), "sessions"))) {
      const record = parseJsonFile<StoredSessionRecord>(filePath);
      if (!record) {
        continue;
      }

      insertSession.run(record.id, record.userId, record.tokenHash, record.createdAt, record.expiresAt);
    }

    for (const filePath of listJsonFiles(getLegacyWorkspaceDir())) {
      const record = parseJsonFile<StoredWorkspaceRecord>(filePath);
      if (!record) {
        continue;
      }

      insertWorkspace.run(
        record.id,
        record.ownerId ?? null,
        JSON.stringify(record.brief),
        JSON.stringify(record.draft),
        JSON.stringify(record.documents),
        record.editedContent,
        record.createdAt,
        record.updatedAt
      );
    }

    setMigrationState.run("json_storage_migrated", "1");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function createDatabase(databasePath: string) {
  ensureDatabaseDir(databasePath);
  const database = new DatabaseSync(databasePath) as NodeSqliteDatabase;
  ensureSchema(database);
  migrateJsonStorage(database);
  return database;
}

export function getDatabase() {
  const databasePath = getDatabasePath();
  const cached = globalThis.__applyRocketDatabaseCache;

  if (cached && cached.databasePath === databasePath) {
    return cached.database;
  }

  if (cached) {
    cached.database.close();
  }

  const database = createDatabase(databasePath);
  globalThis.__applyRocketDatabaseCache = { databasePath, database };
  return database;
}

export function resetDatabaseForTests() {
  const cached = globalThis.__applyRocketDatabaseCache;
  if (!cached) {
    return;
  }

  cached.database.close();
  globalThis.__applyRocketDatabaseCache = undefined;
}
