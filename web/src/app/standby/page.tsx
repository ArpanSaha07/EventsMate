import { StandbyList } from "@/components/standby/StandbyList";

export default function StandbyPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Standby</h1>
      <p className="mt-1 text-muted-foreground">
        Seats you are waiting for. PayPal holds the money; you are charged only if the agent gets
        you a seat.
      </p>
      <div className="mt-6">
        <StandbyList />
      </div>
    </main>
  );
}
