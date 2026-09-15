import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const LEGACY_APPLICATION_OWNER_COOKIE_NAME = "applyrocket.application-owner";
const LEGACY_APPLICATION_OWNER_COOKIE_PATTERN = /^[a-f0-9]{64}$/i;

export async function getLegacyApplicationOwnerId(): Promise<string | null> {
  const cookieStore = await cookies();
  const ownerId = cookieStore.get(LEGACY_APPLICATION_OWNER_COOKIE_NAME)?.value;

  if (!ownerId || !LEGACY_APPLICATION_OWNER_COOKIE_PATTERN.test(ownerId)) {
    return null;
  }

  return ownerId;
}

export function clearLegacyApplicationOwnerCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: LEGACY_APPLICATION_OWNER_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0)
  });

  return response;
}
