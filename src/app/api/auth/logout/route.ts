import { NextResponse } from "next/server";
import { clearSessionCookie, deleteUserSession, getCurrentSessionToken } from "@/lib/auth";

export async function POST() {
  const token = await getCurrentSessionToken();
  if (token) {
    await deleteUserSession(token);
  }

  return clearSessionCookie(NextResponse.json({ ok: true }));
}
