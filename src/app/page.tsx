import { AppWorkspace } from "@/components/app-workspace";

export default function Page() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <div className="ambient-gradient pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-xl">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-cyan-200">ApplyRocket.AI</p>
            <h1 className="mt-1 text-lg font-medium text-white">Job application drafting workspace</h1>
          </div>
          <div className="rounded-full border border-white/10 bg-slate-950/80 px-4 py-2 text-xs font-medium uppercase tracking-[0.25em] text-slate-300">
            Editable cover letter flow
          </div>
        </header>

        <AppWorkspace />
      </div>
    </main>
  );
}

// watch-trigger: edit to verify auto-reload
