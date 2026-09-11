import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthError, authenticateUser, createUserSession, deleteUserSession, getUserBySessionToken, registerUser } from "./auth";
import { getDatabase, resetDatabaseForTests } from "./database";

describe("auth store", () => {
  let tempDir: string;
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousAuthDataDir = process.env.AUTH_DATA_DIR;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "applyrocket-auth-"));
    process.env.DATABASE_PATH = path.join(tempDir, "app.db");
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

    if (previousAuthDataDir === undefined) {
      delete process.env.AUTH_DATA_DIR;
    } else {
      process.env.AUTH_DATA_DIR = previousAuthDataDir;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("stores hashed passwords instead of plain text", async () => {
    const user = await registerUser("person@example.com", "verysecurepassword");
    const row = getDatabase().prepare("SELECT * FROM users WHERE id = ?").get(user.id) as Record<string, unknown>;

    expect(user.email).toBe("person@example.com");
    expect(String(row.password_hash)).not.toBe("verysecurepassword");
    expect(String(row.password_salt)).not.toHaveLength(0);
    expect(String(row.email)).toBe("person@example.com");
    expect(String(row.id)).toBe(user.id);
  });

  it("rejects duplicate registrations", async () => {
    await registerUser("person@example.com", "verysecurepassword");

    await expect(registerUser("person@example.com", "anothersecurepassword")).rejects.toThrow(AuthError);
  });

  it("authenticates valid credentials and rejects invalid ones", async () => {
    const user = await registerUser("person@example.com", "verysecurepassword");

    await expect(authenticateUser("person@example.com", "verysecurepassword")).resolves.toMatchObject({ id: user.id });
    await expect(authenticateUser("person@example.com", "wrongpassword")).rejects.toThrow("Invalid email or password.");
  });

  it("creates sessions backed by hashed tokens", async () => {
    const user = await registerUser("person@example.com", "verysecurepassword");
    const sessionToken = await createUserSession(user.id);

    expect(sessionToken).toHaveLength(64);
    await expect(getUserBySessionToken(sessionToken)).resolves.toMatchObject({ id: user.id });

    const sessionRows = getDatabase().prepare("SELECT token_hash FROM sessions WHERE user_id = ?").all(user.id) as Array<Record<string, unknown>>;
    expect(String(sessionRows[0]?.token_hash)).not.toContain(sessionToken);
  });

  it("deletes sessions on logout", async () => {
    const user = await registerUser("person@example.com", "verysecurepassword");
    const sessionToken = await createUserSession(user.id);

    await deleteUserSession(sessionToken);

    await expect(getUserBySessionToken(sessionToken)).resolves.toBeNull();
  });

  it("migrates legacy json users and sessions into sqlite", async () => {
    const legacyAuthDir = process.env.AUTH_DATA_DIR!;
    await fs.mkdir(path.join(legacyAuthDir, "users"), { recursive: true });
    await fs.mkdir(path.join(legacyAuthDir, "sessions"), { recursive: true });
    await fs.writeFile(
      path.join(legacyAuthDir, "users", "user-1.json"),
      JSON.stringify({
        id: "user-1",
        email: "legacy@example.com",
        passwordHash: "hash",
        passwordSalt: "salt",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(legacyAuthDir, "sessions", "session-1.json"),
      JSON.stringify({
        id: "session-1",
        userId: "user-1",
        tokenHash: "abc123",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z"
      }),
      "utf8"
    );

    resetDatabaseForTests();
    const database = getDatabase();
    const userRow = database.prepare("SELECT email FROM users WHERE id = ?").get("user-1") as Record<string, unknown>;
    const sessionRow = database.prepare("SELECT user_id FROM sessions WHERE id = ?").get("session-1") as Record<string, unknown>;

    expect(String(userRow.email)).toBe("legacy@example.com");
    expect(String(sessionRow.user_id)).toBe("user-1");
  });
});
