/** Event date formatting, always in the event's own timezone. */

export function formatEventDay(startsAt: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(startsAt));
}

function time(value: string, timezone: string, withZone = false): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: withZone ? "short" : undefined,
  }).format(new Date(value));
}

/** "6:00 PM – 9:00 PM PST" */
export function formatEventTimeRange(startsAt: string, endsAt: string, timezone: string): string {
  return `${time(startsAt, timezone)} – ${time(endsAt, timezone, true)}`;
}

/** "Mon, Nov 16, 4:00 PM PST" */
export function formatMoment(value: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}
