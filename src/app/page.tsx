import { AppWorkspace } from "@/components/app-workspace";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Page() {
  return (
    <main className="relative isolate min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6">
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

        <AppWorkspace />
      </div>
    </main>
  );
}
