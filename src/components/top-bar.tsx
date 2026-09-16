"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { useEffect, useState } from "react";
import type { AuthUser } from "@/lib/types";

export function TopBar() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const response = await fetch("/api/auth/session");
        const payload = (await response.json().catch(() => ({}))) as { user?: AuthUser | null };
        if (!active) return;
        if (response.ok && payload.user) {
          setAuthUser(payload.user);
        }
      } catch {
        // ignore
      } finally {
        if (active) setChecked(true);
      }
    }
    void bootstrap();
    return () => { active = false; };
  }, []);

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setAuthUser(null);
    }
  }

  if (!checked) {
    return (
      <header className="surface-panel flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-accent">ApplyRocket.AI</p>
          <h1 className="mt-1 text-lg font-medium text-heading">Job application drafting workspace</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="surface-sunken hidden rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.25em] text-body sm:block">
            Editable cover letter flow
          </div>
          <ThemeToggle />
        </div>
      </header>
    );
  }

  return (
    <header className="surface-panel flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] px-5 py-4">
      <div>
        <p className="text-xs uppercase tracking-[0.32em] text-accent">ApplyRocket.AI</p>
        <h1 className="mt-1 text-lg font-medium text-heading">Job application drafting workspace</h1>
      </div>
      <div className="flex items-center gap-3">
        {authUser ? (
          <button
            className="secondary-button text-xs"
            onClick={signOut}
            type="button"
          >
            Sign out ({authUser.email})
          </button>
        ) : null}
        <div className="surface-sunken hidden rounded-full px-4 py-2 text-xs font-medium uppercase tracking-[0.25em] text-body sm:block">
          Editable cover letter flow
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
