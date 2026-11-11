import { PlanChat } from "@/components/discovery/PlanChat";

export default function PlanPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Plan with AI</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find and recommend events tailored to your schedule, topics, and budget.
        </p>
      </div>
      <PlanChat />
    </main>
  );
}

