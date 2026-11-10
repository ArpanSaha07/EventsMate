import { Badge } from "@/components/ui/badge";
import { SetupStatus } from "@/components/SetupStatus";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">EventsMate</h1>
          <Badge variant="secondary">Sandbox Demo</Badge>
        </div>
        <p className="mt-2 text-muted-foreground">
          An AI event concierge that finds bookable events within your budget and books them
          through PayPal, with your approval.
        </p>
      </header>

      <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
        Integration status
      </h2>
      <SetupStatus />
      <p className="mt-4 text-sm text-muted-foreground">
        Fill in <code className="font-mono">.env.local</code> and restart the dev server until
        every check passes. The chat experience replaces this page next.
      </p>
    </main>
  );
}
