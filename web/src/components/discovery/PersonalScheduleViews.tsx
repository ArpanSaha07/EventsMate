import Link from "next/link";
import {
  CalendarDays,
  MapPin,
  Ticket,
  Hourglass,
  AlertTriangle,
  ArrowUpRight,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatEventDay, formatEventTimeRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type {
  GroupedTicketItem,
  StandbyStatusItem,
  UpcomingSchedulePayload,
  UserTicketsPayload,
} from "@/lib/discovery/types";

export function AuthPromptView() {
  return (
    <div className="w-full rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <UserCheck className="size-4" aria-hidden />
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-foreground">Demo persona required</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Please select a demo persona from the switcher at the top right of the navigation bar to
            view your tickets, schedule, or standby requests.
          </p>
        </div>
      </div>
    </div>
  );
}

function TicketRow({ item, isPast = false }: { item: GroupedTicketItem; isPast?: boolean }) {
  return (
    <div
      className={`rounded-xl border bg-card p-3.5 transition-colors hover:border-primary/40 ${
        isPast ? "opacity-75" : ""
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/events/${item.eventId}`}
              className="font-medium text-sm text-foreground hover:underline inline-flex items-center gap-1 group"
            >
              <span>{item.eventTitle}</span>
              <ArrowUpRight className="size-3 text-muted-foreground group-hover:text-primary transition-colors" />
            </Link>
            {item.howSoon && (
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 h-4 ${
                  item.howSoon === "Happening now"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold"
                    : "border-primary/30 bg-primary/10 text-primary"
                }`}
              >
                {item.howSoon}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3" aria-hidden />
              <span>
                {formatEventDay(item.startsAt, item.timezone)} ·{" "}
                {formatEventTimeRange(item.startsAt, item.endsAt, item.timezone)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              <span>{item.venue}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
          <Badge variant="outline" className="text-xs font-normal">
            {item.quantity} × {item.tierName}
          </Badge>
          <span className="text-xs font-semibold tabular-nums text-foreground">
            {formatMoney(item.totalPriceCents)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function UserTicketsView({ tickets }: { tickets: UserTicketsPayload }) {
  const hasAnyTickets =
    tickets.upcoming.length > 0 || tickets.past.length > 0 || tickets.other.length > 0;

  if (!hasAnyTickets) {
    return (
      <div className="w-full rounded-xl border bg-card p-6 text-center space-y-2">
        <Ticket className="mx-auto size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">You don&apos;t have any tickets yet</p>
        <p className="text-xs text-muted-foreground">
          Browse upcoming events and choose an event to purchase tickets.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 pt-1">
      {tickets.upcoming.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground px-0.5">
            <span>Upcoming Tickets ({tickets.upcoming.length})</span>
          </div>
          <div className="space-y-2">
            {tickets.upcoming.map((t) => (
              <TicketRow key={`${t.eventId}-${t.tierId}`} item={t} />
            ))}
          </div>
        </div>
      )}

      {tickets.past.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground px-0.5">
            <span>Past Tickets ({tickets.past.length})</span>
          </div>
          <div className="space-y-2">
            {tickets.past.map((t) => (
              <TicketRow key={`${t.eventId}-${t.tierId}`} item={t} isPast />
            ))}
          </div>
        </div>
      )}

      {tickets.other.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground px-0.5">
            <span>Released &amp; Transferred Tickets ({tickets.other.length})</span>
          </div>
          <div className="space-y-2">
            {tickets.other.map((t) => (
              <div
                key={`${t.eventId}-${t.tierId}-${t.status}`}
                className="rounded-xl border bg-card/60 p-3 text-xs flex flex-wrap items-center justify-between gap-2"
              >
                <div className="space-y-0.5 min-w-0">
                  <Link
                    href={`/events/${t.eventId}`}
                    className="font-medium text-foreground hover:underline inline-flex items-center gap-1"
                  >
                    <span>{t.eventTitle}</span>
                    <ArrowUpRight className="size-3 text-muted-foreground" />
                  </Link>
                  <p className="text-muted-foreground text-[11px]">
                    {t.status === "released"
                      ? "Released for resale (still yours until captured by fan on standby)"
                      : "Transferred / refunded"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[11px]">
                    {t.quantity} × {t.tierName}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      t.status === "released"
                        ? "border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                        : "border-muted-foreground/30 bg-muted text-muted-foreground"
                    }`}
                  >
                    {t.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-1">
        <Link
          href="/tickets"
          className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1"
        >
          <span>Manage tickets in My tickets</span>
          <ArrowUpRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

export function UpcomingScheduleView({ schedule }: { schedule: UpcomingSchedulePayload }) {
  if (schedule.events.length === 0) {
    return (
      <div className="w-full rounded-xl border bg-card p-6 text-center space-y-2">
        <CalendarDays className="size-6 text-muted-foreground mx-auto" aria-hidden />
        <p className="text-sm font-medium">No upcoming ticketed events</p>
        <p className="text-xs text-muted-foreground">
          You don&apos;t have any tickets to future events right now.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3 pt-1">
      {schedule.hasOverlaps && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Schedule overlap detected</p>
            <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
              Two or more of your upcoming ticketed events overlap in time. Check the items flagged
              below.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {schedule.events.map((ev, index) => {
          const isNext = index === 0;
          const hasOverlap = ev.overlapsWith && ev.overlapsWith.length > 0;

          return (
            <div
              key={`${ev.eventId}-${ev.tierId}`}
              className={`rounded-xl border bg-card p-3.5 space-y-2 transition-colors ${
                isNext ? "border-primary/40 shadow-xs" : ""
              } ${hasOverlap ? "border-amber-500/40" : ""}`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {isNext && (
                      <Badge className="bg-primary text-primary-foreground text-[10px] h-4 px-1.5 font-semibold">
                        Next up
                      </Badge>
                    )}
                    <Link
                      href={`/events/${ev.eventId}`}
                      className="font-medium text-sm text-foreground hover:underline inline-flex items-center gap-1 group"
                    >
                      <span>{ev.eventTitle}</span>
                      <ArrowUpRight className="size-3 text-muted-foreground group-hover:text-primary transition-colors" />
                    </Link>
                    {ev.howSoon && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 h-4 ${
                          ev.howSoon === "Happening now"
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold"
                            : "border-primary/30 bg-primary/10 text-primary"
                        }`}
                      >
                        {ev.howSoon}
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="size-3" aria-hidden />
                      <span>
                        {formatEventDay(ev.startsAt, ev.timezone)} ·{" "}
                        {formatEventTimeRange(ev.startsAt, ev.endsAt, ev.timezone)}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" aria-hidden />
                      <span>{ev.venue}</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-xs">
                    {ev.quantity} × {ev.tierName}
                  </Badge>
                </div>
              </div>

              {hasOverlap && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="size-3 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    Time overlap with: <span className="font-semibold">{ev.overlapsWith?.join(", ")}</span>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-1">
        <Link
          href="/tickets"
          className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1"
        >
          <span>View all tickets and details in My tickets</span>
          <ArrowUpRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

const STANDBY_TONES = {
  authorized: "border-primary/30 bg-primary/10 text-primary",
  matched: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  settled: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  draft: "border-border bg-muted text-muted-foreground",
  cancelled: "border-border bg-muted text-muted-foreground",
  expired: "border-border bg-muted text-muted-foreground",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function StandbySummaryView({ items }: { items: StandbyStatusItem[] }) {
  if (items.length === 0) {
    return (
      <div className="w-full rounded-xl border bg-card p-6 text-center space-y-2">
        <Hourglass className="mx-auto size-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">No active standby requests</p>
        <p className="text-xs text-muted-foreground">
          When an event sells out, you can join standby with a PayPal hold and no upfront charge.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3 pt-1">
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border bg-card p-3.5 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/events/${item.eventId}`}
                    className="font-medium text-sm text-foreground hover:underline inline-flex items-center gap-1 group"
                  >
                    <span>{item.eventTitle}</span>
                    <ArrowUpRight className="size-3 text-muted-foreground group-hover:text-primary transition-colors" />
                  </Link>
                  <Badge
                    variant="outline"
                    className={`text-[10px] capitalize ${STANDBY_TONES[item.status] ?? "border-border"}`}
                  >
                    {item.status}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="size-3" aria-hidden />
                    <span>{formatEventDay(item.startsAt, item.timezone)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" aria-hidden />
                    <span>{item.venue}</span>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                <Badge variant="outline" className="text-xs">
                  {item.quantity} seat{item.quantity > 1 ? "s" : ""} · {item.tiersSummary}
                </Badge>
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  Hold: {formatMoney(item.authorizedCents)}
                </span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed rounded-md bg-muted/40 p-2 border border-border/50">
              {item.statusDescription}
            </p>
          </div>
        ))}
      </div>

      <div className="pt-1">
        <Link
          href="/standby"
          className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1"
        >
          <span>Manage requests in Standby</span>
          <ArrowUpRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

