import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthError, authenticateUser, createUserSession, deleteUserSession, getUserBySessionToken, registerUser } from "./auth";

describe("auth store", () => {
  let tempDir: string;
  const previousAuthDataDir = process.env.AUTH_DATA_DIR;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "applyrocket-auth-"));
    process.env.AUTH_DATA_DIR = tempDir;
  });

  afterEach(async () => {
    if (previousAuthDataDir === undefined) {
      delete process.env.AUTH_DATA_DIR;
    } else {
      process.env.AUTH_DATA_DIR = previousAuthDataDir;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("stores hashed passwords instead of plain text", async () => {
    const user = await registerUser("person@example.com", "verysecurepassword");
    const files = await fs.readdir(path.join(tempDir, "users"));
    const fileContent = await fs.readFile(path.join(tempDir, "users", files[0]!), "utf8");
    const record = JSON.parse(fileContent) as { passwordHash: string; passwordSalt: string; email: string; id: string };

    expect(user.email).toBe("person@example.com");
    expect(record.passwordHash).not.toBe("verysecurepassword");
    expect(record.passwordSalt).not.toHaveLength(0);
    expect(record.email).toBe("person@example.com");
    expect(record.id).toBe(user.id);
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

    const sessionFiles = await fs.readdir(path.join(tempDir, "sessions"));
    expect(sessionFiles[0]).not.toContain(sessionToken);
  });

  it("deletes sessions on logout", async () => {
    const user = await registerUser("person@example.com", "verysecurepassword");
    const sessionToken = await createUserSession(user.id);

    await deleteUserSession(sessionToken);

    await expect(getUserBySessionToken(sessionToken)).resolves.toBeNull();
  });
});
