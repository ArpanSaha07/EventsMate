"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, MapPin, Ticket } from "lucide-react";
import { toast } from "sonner";
import { ReleaseDialog } from "@/components/tickets/ReleaseDialog";
import { usePersona } from "@/components/shell/PersonaProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEventDay, formatEventTimeRange, formatMoment } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { MyTicket } from "@/lib/types";
import { postJson, useApi } from "@/lib/use-api";

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-8 text-center">
      <Ticket className="mx-auto size-6 text-muted-foreground" aria-hidden />
      <p className="mt-3 font-medium">{title}</p>
      <div className="mt-1 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export function TicketList() {
  const { status: personaStatus, current } = usePersona();
  const { status, data, error, reload } = useApi<{ tickets: MyTicket[] }>(current ? "/api/tickets" : null, [
    current?.id,
  ]);
  const [releasing, setReleasing] = useState<MyTicket | null>(null);
  const [takingBack, setTakingBack] = useState<string | null>(null);

  async function takeBack(ticket: MyTicket) {
    setTakingBack(ticket.id);
    try {
      await postJson(`/api/tickets/${ticket.id}/take-back`);
      toast.success(`${ticket.ticket_number} is yours again and no longer offered for resale.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not take the seat back. Please retry.");
    } finally {
      setTakingBack(null);
      reload();
    }
  }

  if (personaStatus === "ready" && !current) {
    return (
      <EmptyState title="Choose a demo person">
        Use the menu at the top right to see that person&apos;s tickets.
      </EmptyState>
    );
  }

  if (personaStatus !== "ready" || status === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="font-medium">Tickets could not be loaded</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button className="mt-4" variant="outline" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }

  if (data.tickets.length === 0) {
    return (
      <EmptyState title={`${current?.name} has no tickets yet`}>
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Browse events
        </Link>{" "}
        to buy one.
      </EmptyState>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {data.tickets.map((ticket) => (
          <li key={ticket.id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/events/${ticket.event.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {ticket.event.title}
                  </Link>
                  <Badge variant="secondary">{ticket.tier.name}</Badge>
                  {ticket.status === "released" && (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                      {ticket.resale ? "Being resold" : "Released, still yours"}
                    </Badge>
                  )}
                  {ticket.status === "transferred" && (
                    <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-900">
                      Resold
                    </Badge>
                  )}
                  {ticket.from_standby && ticket.status !== "transferred" && (
                    <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                      From standby
                    </Badge>
                  )}
                </div>
                <div className="mt-1.5 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:gap-5">
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="size-4 shrink-0" aria-hidden />
                    {formatEventDay(ticket.event.starts_at, ticket.event.timezone)} ·{" "}
                    {formatEventTimeRange(
                      ticket.event.starts_at,
                      ticket.event.ends_at,
                      ticket.event.timezone,
                    )}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-4 shrink-0" aria-hidden />
                    {ticket.event.venue}
                  </span>
                </div>
              </div>
              <div className="text-right text-sm">
                <p className="font-mono">{ticket.ticket_number}</p>
                <p className="text-muted-foreground">Paid {formatMoney(ticket.unit_price_cents)}</p>
              </div>
            </div>

            {ticket.status === "transferred" && (
              <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                {ticket.resale ? (
                  <>
                    The agent resold this seat to a fan on standby. PayPal refunded you{" "}
                    <span className="font-medium text-foreground">
                      {formatMoney(ticket.resale.refund_cents)}
                    </span>{" "}
                    ({ticket.resale.refund_terms.toLowerCase()})
                    {ticket.resale.refund_id && (
                      <>
                        , ref <span className="font-mono">{ticket.resale.refund_id}</span>
                      </>
                    )}
                    . This ticket is no longer valid for entry.
                  </>
                ) : (
                  "This ticket was resold and is no longer valid for entry."
                )}
              </p>
            )}

            {ticket.status === "released" && ticket.resale && (
              <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                The agent matched this seat to a fan on standby and is finishing the payment with PayPal.
                Your {formatMoney(ticket.resale.refund_cents)} refund has not been sent yet; the ticket
                stays yours until it has.
              </p>
            )}

            {ticket.status === "released" && !ticket.resale && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                  Offered to fans on standby.{" "}
                  {ticket.refund && (
                    <>
                      If it is resold now you get{" "}
                      <span className="font-medium text-foreground">
                        {formatMoney(ticket.refund.refund_cents)}
                      </span>{" "}
                      back ({ticket.refund.terms.toLowerCase()})
                      {ticket.refund.next &&
                        `, or ${formatMoney(ticket.refund.next.refund_cents)} after ${formatMoment(ticket.refund.next.at, ticket.event.timezone)}`}
                      .{" "}
                    </>
                  )}
                  If nobody takes it by {formatMoment(ticket.release_cutoff_at, ticket.event.timezone)}, it
                  returns to you with no refund.
                </p>
                <Button variant="outline" disabled={takingBack !== null} onClick={() => takeBack(ticket)}>
                  {takingBack === ticket.id ? "Taking back…" : "Take it back"}
                </Button>
              </div>
            )}

            {ticket.status === "valid" && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                  {ticket.returned_at && (
                    <span className="block text-foreground">
                      Returned to you at the cutoff: nobody on standby took it. No refund was made.
                    </span>
                  )}
                  {ticket.release_blocked
                    ? `Can't be released: ${ticket.release_blocked}`
                    : "Can't make it? Release the seat and get a refund when it is resold."}
                </p>
                {!ticket.release_blocked && (
                  <Button variant="outline" onClick={() => setReleasing(ticket)}>
                    Release seat
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {releasing && (
        <ReleaseDialog
          key={releasing.id}
          initialId={releasing.id}
          tickets={data.tickets.filter(
            (ticket) =>
              ticket.event.id === releasing.event.id && ticket.status === "valid" && !ticket.release_blocked,
          )}
          onClose={() => setReleasing(null)}
          onReleased={reload}
        />
      )}
    </>
  );
}
