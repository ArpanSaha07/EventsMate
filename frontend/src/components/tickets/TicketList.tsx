"use client";

import Link from "next/link";
import { CalendarDays, MapPin, Ticket } from "lucide-react";
import { usePersona } from "@/components/shell/PersonaProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEventDay, formatEventTimeRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { MyTicket } from "@/lib/types";
import { useApi } from "@/lib/use-api";

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
  const { status, data, error, reload } = useApi<{ tickets: MyTicket[] }>(
    current ? "/api/tickets" : null,
    [current?.id],
  );

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
    <ul className="space-y-3">
      {data.tickets.map((ticket) => (
        <li
          key={ticket.id}
          className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card p-4"
        >
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
                  Released, still yours
                </Badge>
              )}
            </div>
            <div className="mt-1.5 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:gap-5">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-4 shrink-0" aria-hidden />
                {formatEventDay(ticket.event.starts_at, ticket.event.timezone)} ·{" "}
                {formatEventTimeRange(ticket.event.starts_at, ticket.event.ends_at, ticket.event.timezone)}
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
        </li>
      ))}
    </ul>
  );
}
