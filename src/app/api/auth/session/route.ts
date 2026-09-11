import { NextResponse } from "next/server";
import { clearSessionCookie, getAuthenticatedUser } from "@/lib/auth";

export async function GET() {
  const user = await getAuthenticatedUser();
  const response = NextResponse.json({ user });

  if (!user) {
    return clearSessionCookie(response);
  }

  return response;
}
