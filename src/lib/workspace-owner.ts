import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const LEGACY_WORKSPACE_OWNER_COOKIE_NAME = "applyrocket.workspace-owner";
const LEGACY_WORKSPACE_OWNER_COOKIE_PATTERN = /^[a-f0-9]{64}$/i;

export async function getLegacyWorkspaceOwnerId(): Promise<string | null> {
  const cookieStore = await cookies();
  const ownerId = cookieStore.get(LEGACY_WORKSPACE_OWNER_COOKIE_NAME)?.value;

  if (!ownerId || !LEGACY_WORKSPACE_OWNER_COOKIE_PATTERN.test(ownerId)) {
    return null;
  }

  return ownerId;
}

export function clearLegacyWorkspaceOwnerCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: LEGACY_WORKSPACE_OWNER_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0)
  });

  return response;
}
