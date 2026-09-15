import { NextResponse } from "next/server";
import { clearLegacyApplicationOwnerCookie, getLegacyApplicationOwnerId } from "@/lib/application-owner";
import { migrateApplicationOwner } from "@/lib/application-store";
import { attachSessionCookie, AuthError, authenticateUser, createUserSession } from "@/lib/auth";
import { migrateDocumentOwner } from "@/lib/document-store";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid login payload." }, { status: 400 });
  }

  const candidate = body as Record<string, unknown>;
  if (!isString(candidate.email) || !isString(candidate.password)) {
    return NextResponse.json({ error: "Invalid login payload." }, { status: 400 });
  }

  try {
    const user = await authenticateUser(candidate.email, candidate.password);
    const legacyOwnerId = await getLegacyApplicationOwnerId();
    if (legacyOwnerId) {
      await migrateApplicationOwner(legacyOwnerId, user.id);
      await migrateDocumentOwner(legacyOwnerId, user.id);
    }

    const sessionToken = await createUserSession(user.id);
    const response = attachSessionCookie(NextResponse.json({ user }), sessionToken);
    return clearLegacyApplicationOwnerCookie(response);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    throw error;
  }
}
