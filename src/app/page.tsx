import { ApplicationWorkspace } from "@/components/application-workspace";
import { TopBar } from "@/components/top-bar";

export default function Page() {
  return (
    <main className="relative isolate min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6">
        <TopBar />
        <ApplicationWorkspace />
      </div>
    </main>
  );
}
