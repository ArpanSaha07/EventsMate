import { CurrentPersonaCard } from "@/components/shell/CurrentPersonaCard";
import { SetupStatus } from "@/components/SetupStatus";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">EventsMate</h1>
      <p className="mt-2 text-muted-foreground">
        An AI agent that fills empty seats at sold-out events. Fans wait with a PayPal hold;
        when a holder releases a seat, the agent resells it and refunds the holder.
      </p>

      <div className="mt-6">
        <CurrentPersonaCard />
      </div>

      <h2 className="mt-10 mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
        Integration status
      </h2>
      <SetupStatus />
      <p className="mt-4 text-sm text-muted-foreground">
        Every check must pass before payments work. The events list replaces this page next.
      </p>
    </main>
  );
}
