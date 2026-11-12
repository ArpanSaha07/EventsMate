"use client";

import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TierAvailability } from "@/components/events/TierAvailability";
import { formatEventDay, formatEventTimeRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { EventWithTiers } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export function EventList() {
  const { status, data, error, reload } = useApi<{ events: EventWithTiers[] }>("/api/events");

  if (status === "loading") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-52 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="font-medium">Events could not be loaded</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button className="mt-4" variant="outline" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }

  if (data.events.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="font-medium">No upcoming events</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Demo events are seeded relative to today. Run <code className="font-mono">npm run db:seed</code>{" "}
          to load a fresh set.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.events.map((event) => {
        const lowest = Math.min(...event.ticket_tiers.map((t) => t.price_cents));
        return (
          <li key={event.id}>
            <Link
              href={`/events/${event.id}`}
              className="group flex h-full flex-col rounded-xl border bg-card p-5 transition-shadow outline-none hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary">{event.category}</Badge>
                <span className="text-sm text-muted-foreground">From {formatMoney(lowest)}</span>
              </div>

              <h2 className="mt-3 text-lg leading-snug font-semibold tracking-tight group-hover:text-primary">
                {event.title}
              </h2>

              <dl className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <div className="flex items-start gap-2">
                  <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <dt className="sr-only">When</dt>
                  <dd>
                    {formatEventDay(event.starts_at, event.timezone)} ·{" "}
                    {formatEventTimeRange(event.starts_at, event.ends_at, event.timezone)}
                  </dd>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <dt className="sr-only">Where</dt>
                  <dd>
                    {event.venue}, {event.city}
                  </dd>
                </div>
              </dl>

              <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-2 pt-4 text-sm">
                {event.ticket_tiers.map((tier) => (
                  <li key={tier.id} className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">{tier.name}</span>
                    <TierAvailability tier={tier} />
                  </li>
                ))}
              </ul>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
