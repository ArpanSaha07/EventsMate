"use client";

import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TierAvailability } from "@/components/events/TierAvailability";
import { formatEventDay, formatEventTimeRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { EventWithTiers } from "@/lib/types";

export function EventCard({ event }: { event: EventWithTiers }) {
  const lowest =
    event.ticket_tiers.length > 0
      ? Math.min(...event.ticket_tiers.map((t) => t.price_cents))
      : 0;

  return (
    <Link
      href={`/events/${event.id}`}
      className="group flex h-full flex-col rounded-xl border bg-card p-5 transition-shadow outline-none hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary">{event.category}</Badge>
        <span className="text-sm text-muted-foreground">From {formatMoney(lowest)}</span>
      </div>

      <h3 className="mt-3 text-lg leading-snug font-semibold tracking-tight group-hover:text-primary">
        {event.title}
      </h3>

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
  );
}
