import { createHash, randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getDatabase } from "./database";
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

function mapUserRow(row: Record<string, unknown> | undefined): StoredUserRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    passwordSalt: String(row.password_salt),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSessionRow(row: Record<string, unknown> | undefined): StoredSessionRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    userId: String(row.user_id),
    tokenHash: String(row.token_hash),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at)
  };
}

function readUserRecordById(id: string): StoredUserRecord | null {
  const database = getDatabase();
  const row = database.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return mapUserRow(row);
}

function findUserRecordByEmail(email: string): StoredUserRecord | null {
  const database = getDatabase();
  const row = database.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) as Record<string, unknown> | undefined;
  return mapUserRow(row);
}

function readSessionRecord(token: string): StoredSessionRecord | null {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    return null;
  }

  const database = getDatabase();
  const tokenHash = hashSessionToken(token);
  const row = database.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) as Record<string, unknown> | undefined;
  const record = mapSessionRow(row);

  if (!record) {
    return null;
  }

  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }

  return record;
}

export async function registerUser(email: string, password: string): Promise<AuthUser> {
  validateEmail(email);
  validatePassword(password);

  const normalizedEmail = normalizeEmail(email);
  const existingUser = findUserRecordByEmail(normalizedEmail);
  if (existingUser) {
    throw new AuthError("An account with that email already exists.");
  }

  const now = new Date().toISOString();
  const passwordSalt = randomBytes(16).toString("hex");
  const passwordHash = await derivePasswordHash(password, passwordSalt);
  const record: StoredUserRecord = {
    id: randomUUID(),
    email: normalizedEmail,
    passwordHash,
    passwordSalt,
    createdAt: now,
    updatedAt: now
  };

  const database = getDatabase();
  database
    .prepare("INSERT INTO users (id, email, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(record.id, record.email, record.passwordHash, record.passwordSalt, record.createdAt, record.updatedAt);

  return toAuthUser(record);
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser> {
  validateEmail(email);
  validatePassword(password);

  const record = findUserRecordByEmail(email);
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
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_COOKIE_MAX_AGE * 1000).toISOString();

  getDatabase()
    .prepare("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), userId, tokenHash, createdAt, expiresAt);

  return token;
}

export async function getUserBySessionToken(token: string): Promise<AuthUser | null> {
  const sessionRecord = readSessionRecord(token);
  if (!sessionRecord) {
    return null;
  }

  const userRecord = readUserRecordById(sessionRecord.userId);
  if (!userRecord) {
    return null;
  }

  return toAuthUser(userRecord);
}

export async function deleteUserSession(token: string): Promise<void> {
  if (!SESSION_TOKEN_PATTERN.test(token)) {
    return;
  }

  getDatabase().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
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
