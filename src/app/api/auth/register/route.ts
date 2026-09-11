import { NextResponse } from "next/server";
import { attachSessionCookie, AuthError, createUserSession, registerUser } from "@/lib/auth";
import { clearLegacyWorkspaceOwnerCookie, getLegacyWorkspaceOwnerId } from "@/lib/workspace-owner";
import { migrateWorkspaceOwner } from "@/lib/workspace-store";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid registration payload." }, { status: 400 });
  }

  const candidate = body as Record<string, unknown>;
  if (!isString(candidate.email) || !isString(candidate.password)) {
    return NextResponse.json({ error: "Invalid registration payload." }, { status: 400 });
  }

  try {
    const user = await registerUser(candidate.email, candidate.password);
    const legacyOwnerId = await getLegacyWorkspaceOwnerId();
    if (legacyOwnerId) {
      await migrateWorkspaceOwner(legacyOwnerId, user.id);
    }

    const sessionToken = await createUserSession(user.id);
    const response = attachSessionCookie(NextResponse.json({ user }, { status: 201 }), sessionToken);
    return clearLegacyWorkspaceOwnerCookie(response);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    throw error;
  }
}
