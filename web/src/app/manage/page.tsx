import { ManagedEventList } from "@/components/manage/ManagedEventList";

export default function ManagePage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">My events</h1>
      <p className="mt-1 text-muted-foreground">
        Write each refund policy in plain words. The policy reader turns it into a rule; nothing
        applies until you confirm it.
      </p>
      <div className="mt-6">
        <ManagedEventList />
      </div>
    </main>
  );
}
