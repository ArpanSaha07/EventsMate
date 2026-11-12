import { EventList } from "@/components/events/EventList";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Events in San Francisco</h1>
      <p className="mt-1 max-w-2xl text-muted-foreground">
        Sold out? Go on standby with a PayPal hold. If someone releases a seat, the agent gets it
        for you and you are only charged then.
      </p>
      <div className="mt-6">
        <EventList />
      </div>
    </main>
  );
}
