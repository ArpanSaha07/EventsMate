"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";
import { BuyDialog } from "@/components/checkout/BuyDialog";
import { StandbyDialog } from "@/components/standby/StandbyDialog";
import { TierAvailability } from "@/components/events/TierAvailability";
import { usePersona } from "@/components/shell/PersonaProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEventDay, formatEventTimeRange, formatMoment } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { beforeReleaseCutoff, isSoldOut, releaseCutoff, salesOpen } from "@/lib/rules";
import type { EventWithTiers, MyStandbyRequest, Tier } from "@/lib/types";
import { useApi } from "@/lib/use-api";

export function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const { current } = usePersona();
  const { status, data, error, reload } = useApi<{ event: EventWithTiers }>(`/api/events/${id}`);
  const mine = useApi<{ requests: MyStandbyRequest[] }>(current ? "/api/standby" : null, [current?.id]);
  const [buying, setBuying] = useState<Tier | null>(null);
  const [standbyTier, setStandbyTier] = useState<Tier | null>(null);

  if (status === "loading") return <EventDetailSkeleton />;

  if (status === "error") {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="font-medium">This event could not be loaded</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" onClick={reload}>
            Try again
          </Button>
          <Button variant="ghost" render={<Link href="/" />}>
            All events
          </Button>
        </div>
      </div>
    );
  }

  const event = data.event;
  const open = salesOpen(event.starts_at);
  const standbyOpen = beforeReleaseCutoff(event.starts_at);
  const myStandby = mine.data?.requests.find(
    (request) => request.event.id === event.id && request.status === "authorized",
  );

  return (
    <>
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All events
      </Link>

      <header className="mt-3">
        <Badge variant="secondary">{event.category}</Badge>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{event.title}</h1>
        <div className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground sm:flex-row sm:gap-6">
          <span className="flex items-center gap-2">
            <CalendarDays className="size-4 shrink-0" aria-hidden />
            {formatEventDay(event.starts_at, event.timezone)} ·{" "}
            {formatEventTimeRange(event.starts_at, event.ends_at, event.timezone)}
          </span>
          <span className="flex items-center gap-2">
            <MapPin className="size-4 shrink-0" aria-hidden />
            {event.venue}, {event.city}
          </span>
        </div>
        <p className="mt-4 max-w-3xl">{event.description}</p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="tickets-heading" className="lg:col-span-2">
          <h2 id="tickets-heading" className="text-sm font-medium text-muted-foreground">
            Tickets
          </h2>
          <ul className="mt-2 divide-y rounded-xl border bg-card">
            {event.ticket_tiers.map((tier) => (
              <li key={tier.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{tier.name}</span>
                    <TierAvailability tier={tier} />
                  </div>
                  <p className="text-sm text-muted-foreground">{tier.description}</p>
                </div>
                <span className="text-lg font-semibold tabular-nums">
                  {formatMoney(tier.price_cents)}
                </span>
                {open && !isSoldOut(tier) && (
                  <Button size="lg" className="w-full sm:w-auto" onClick={() => setBuying(tier)}>
                    Buy
                  </Button>
                )}
                {standbyOpen && isSoldOut(tier) && !myStandby && (
                  <Button
                    size="lg"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={() => setStandbyTier(tier)}
                  >
                    Go on standby
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {myStandby && (
            <p className="mt-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              You are on standby for {myStandby.quantity} seat{myStandby.quantity === 1 ? "" : "s"} (
              {myStandby.tiers.map((t) => t.name).join(" or ")}), with {formatMoney(myStandby.authorized_cents)}{" "}
              held by PayPal.{" "}
              <Link href="/standby" className="text-primary underline-offset-4 hover:underline">
                Manage
              </Link>
            </p>
          )}
          {!open && (
            <p className="mt-2 text-sm text-muted-foreground">Ticket sales for this event have closed.</p>
          )}
          {open && !current && (
            <p className="mt-2 text-sm text-muted-foreground">
              Choose a demo person (top right) to buy tickets.
            </p>
          )}
        </section>

        <aside aria-labelledby="policy-heading">
          <h2 id="policy-heading" className="text-sm font-medium text-muted-foreground">
            If you can&apos;t make it
          </h2>
          <div className="mt-2 rounded-xl border bg-card p-4 text-sm">
            <p className="font-medium">Refund policy</p>
            <p className="mt-1 text-muted-foreground">{event.refund_policy_text}</p>
            <p className="mt-3 text-muted-foreground">
              Seats can be released until{" "}
              <span className="text-foreground">
                {formatMoment(releaseCutoff(event.starts_at), event.timezone)}
              </span>
              . A released seat stays yours until someone on standby takes it.
            </p>
          </div>
          <p className="mt-3 rounded-xl border bg-card p-4 text-sm">
            <span className="font-medium">
              {event.standby_count === 0
                ? "Nobody is on standby yet"
                : `${event.standby_count} ${event.standby_count === 1 ? "fan is" : "fans are"} on standby`}
            </span>
            <span className="mt-1 block text-muted-foreground">
              Each has a PayPal hold in place, so a released seat can be resold at once.
            </span>
          </p>
        </aside>
      </div>

      {standbyTier && (
        <StandbyDialog
          key={standbyTier.id}
          event={event}
          initialTierId={standbyTier.id}
          open
          onOpenChange={(next) => {
            if (!next) setStandbyTier(null);
          }}
          onAuthorized={() => {
            reload();
            mine.reload();
          }}
        />
      )}

      {buying && (
        <BuyDialog
          key={buying.id}
          event={event}
          tier={event.ticket_tiers.find((t) => t.id === buying.id) ?? buying}
          open
          onOpenChange={(next) => {
            if (!next) setBuying(null);
          }}
          onPaid={reload}
        />
      )}
    </>
  );
}

export function EventDetailSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-9 w-2/3" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-40 rounded-xl lg:col-span-2" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}
