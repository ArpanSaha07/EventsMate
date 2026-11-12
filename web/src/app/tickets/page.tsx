import { TicketList } from "@/components/tickets/TicketList";

export default function TicketsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">My tickets</h1>
      <p className="mt-1 text-muted-foreground">
        Tickets appear here once PayPal has confirmed the payment. If you can&apos;t go, release
        the seat: the agent resells it to a fan on standby and refunds you.
      </p>
      <div className="mt-6">
        <TicketList />
      </div>
    </main>
  );
}
