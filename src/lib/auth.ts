import { createHash, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { AuthUser } from "./types";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE_NAME = "applyrocket.session";
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const PASSWORD_HASH_BYTES = 64;
const PASSWORD_MIN_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

type StoredUserRecord = AuthUser & {
  passwordHash: string;
  passwordSalt: string;
};

type StoredSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function getAuthDataDir() {
  const configuredDataDir = process.env.AUTH_DATA_DIR;
  return configuredDataDir ? path.resolve(configuredDataDir) : path.join(process.cwd(), "data", "auth");
}

function usersDir() {
  return path.join(getAuthDataDir(), "users");
}

function sessionsDir() {
  return path.join(getAuthDataDir(), "sessions");
}

async function ensureAuthDataDirs() {
  await fs.mkdir(usersDir(), { recursive: true });
  await fs.mkdir(sessionsDir(), { recursive: true });
}

function userPath(id: string) {
  return path.join(usersDir(), `${id}.json`);
}

function sessionPath(tokenHash: string) {
  return path.join(sessionsDir(), `${tokenHash}.json`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string) {
  if (!EMAIL_PATTERN.test(normalizeEmail(email))) {
    throw new AuthError("Enter a valid email address.");
  }
}

function validatePassword(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new AuthError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
  }
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function derivePasswordHash(password: string, salt: string): Promise<string> {
  const derivedKey = (await scrypt(password, salt, PASSWORD_HASH_BYTES)) as Buffer;
  return derivedKey.toString("hex");
}

function toAuthUser(record: StoredUserRecord): AuthUser {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...user } = record;
  return user;
}

async function readUserRecordById(id: string): Promise<StoredUserRecord | null> {
  try {
    const fileContent = await fs.readFile(userPath(id), "utf8");
    return JSON.parse(fileContent) as StoredUserRecord;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function findUserRecordByEmail(email: string): Promise<StoredUserRecord | null> {
  const normalizedEmail = normalizeEmail(email);
  const fileNames = await fs.readdir(usersDir());

  for (const fileName of fileNames) {
    if (!fileName.endsWith(".json")) {
      continue;
    }

    const fileContent = await fs.readFile(path.join(usersDir(), fileName), "utf8");
    const record = JSON.parse(fileContent) as StoredUserRecord;
    if (record.email === normalizedEmail) {
      return record;
    }
  }

  return null;
}

async function writeUserRecord(record: StoredUserRecord) {
  await fs.writeFile(userPath(record.id), JSON.stringify(record, null, 2), "utf8");
}

async function readSessionRecord(token: string): Promise<StoredSessionRecord | null> {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    return null;
  }

  const tokenHash = hashSessionToken(token);

  try {
    const fileContent = await fs.readFile(sessionPath(tokenHash), "utf8");
    const record = JSON.parse(fileContent) as StoredSessionRecord;

    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      await fs.unlink(sessionPath(tokenHash)).catch(() => undefined);
      return null;
    }

    return record;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeSessionRecord(record: StoredSessionRecord) {
  await fs.writeFile(sessionPath(record.tokenHash), JSON.stringify(record, null, 2), "utf8");
}

export async function registerUser(email: string, password: string): Promise<AuthUser> {
  await ensureAuthDataDirs();
  validateEmail(email);
  validatePassword(password);

  const normalizedEmail = normalizeEmail(email);
  const existingUser = await findUserRecordByEmail(normalizedEmail);
  if (existingUser) {
    throw new AuthError("An account with that email already exists.");
  }

  const now = new Date().toISOString();
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = await derivePasswordHash(password, passwordSalt);
  const record: StoredUserRecord = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    passwordHash,
    passwordSalt,
    createdAt: now,
    updatedAt: now
  };

  await writeUserRecord(record);
  return toAuthUser(record);
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser> {
  await ensureAuthDataDirs();
  validateEmail(email);
  validatePassword(password);

  const normalizedEmail = normalizeEmail(email);
  const record = await findUserRecordByEmail(normalizedEmail);
  if (!record) {
    throw new AuthError("Invalid email or password.");
  }

  const attemptedHash = await derivePasswordHash(password, record.passwordSalt);
  if (attemptedHash !== record.passwordHash) {
    throw new AuthError("Invalid email or password.");
  }

  return toAuthUser(record);
}

export async function createUserSession(userId: string): Promise<string> {
  await ensureAuthDataDirs();
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_COOKIE_MAX_AGE * 1000).toISOString();

  await writeSessionRecord({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    createdAt: now.toISOString(),
    expiresAt
  });

  return token;
}

export async function getUserBySessionToken(token: string): Promise<AuthUser | null> {
  await ensureAuthDataDirs();
  const sessionRecord = await readSessionRecord(token);
  if (!sessionRecord) {
    return null;
  }

  const userRecord = await readUserRecordById(sessionRecord.userId);
  if (!userRecord) {
    return null;
  }

  return toAuthUser(userRecord);
}

export async function deleteUserSession(token: string): Promise<void> {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    return;
  }

  await fs.unlink(sessionPath(hashSessionToken(token))).catch(() => undefined);
}

export async function getCurrentSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function getAuthenticatedUser(): Promise<AuthUser | null> {
  const token = await getCurrentSessionToken();
  if (!token) {
    return null;
  }

  return getUserBySessionToken(token);
}

export function attachSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE
  });

  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0)
  });

  return response;
}
