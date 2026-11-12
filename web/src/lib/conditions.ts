/**
 * A fan's free-text standby note, read into conditions code can enforce (D54).
 * The model proposes a reading; `checkConditions` decides what is accepted.
 * Pure: no network, no database.
 */
import { z } from "zod";

/** The JSON the model must return (strict structured output: every field required). */
export const conditionsProposalSchema = z.object({
  /** The fan wants all their seats in one ticket type. */
  same_tier: z.boolean(),
  /** The words of the note that say so, copied exactly; null if same_tier is false. */
  same_tier_quote: z.string().nullable(),
  /** "YYYY-MM-DDTHH:mm" in the event's timezone: the fan must know by then. Null if no deadline. */
  decide_by_local: z.string().nullable(),
  decide_by_quote: z.string().nullable(),
  /** Parts of the note that ask for anything else, copied exactly. */
  unsupported: z.array(z.string()),
});

export type ConditionsProposal = z.infer<typeof conditionsProposalSchema>;

/** What is stored on the request and enforced by matching. */
export const standbyConditionsSchema = z.object({
  version: z.literal(1),
  same_tier: z.boolean(),
  /** ISO instant. The request ends then if that is before the release cutoff. */
  decide_by: z.string().nullable(),
  /** Parts of the note that were not understood and are NOT enforced. Shown to the fan. */
  unsupported: z.array(z.string()),
});

export type StandbyConditions = z.infer<typeof standbyConditionsSchema>;

export function parseStandbyConditions(value: unknown): StandbyConditions | null {
  const parsed = standbyConditionsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** A wall-clock time in an IANA timezone, as an instant. Null if the text is not "YYYY-MM-DDTHH:mm". */
export function zonedTimeToUtc(local: string, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute);

  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  // How far the zone's wall clock is ahead of UTC at instant `t`.
  const offsetAt = (t: number) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(t)).map((p) => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - t;
  };
  // Two passes settle the offset across a daylight-saving change.
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

/**
 * Accepts a condition only when the model quotes the fan's own words for it and
 * the value is usable. Everything else in the reading is kept as "unsupported"
 * so it is shown to the fan and never silently dropped.
 */
export function checkConditions(
  raw: unknown,
  note: string,
  context: { timezone: string; now: Date },
): StandbyConditions {
  const proposal = conditionsProposalSchema.parse(raw);
  const text = squash(note);
  const quoted = (quote: string | null): quote is string => !!quote && squash(quote) !== "" && text.includes(squash(quote));

  const unsupported: string[] = [];
  const keep = (part: string | null) => {
    const clean = part?.replace(/\s+/g, " ").trim();
    if (clean && text.includes(squash(clean)) && !unsupported.some((u) => squash(u) === squash(clean))) {
      unsupported.push(clean.slice(0, 200));
    }
  };

  const sameTier = proposal.same_tier && quoted(proposal.same_tier_quote);
  if (proposal.same_tier && !sameTier) keep(proposal.same_tier_quote);

  let decideBy: string | null = null;
  if (proposal.decide_by_local !== null) {
    const at = quoted(proposal.decide_by_quote) ? zonedTimeToUtc(proposal.decide_by_local, context.timezone) : null;
    // A deadline that has already passed cannot be honoured, so it is not accepted.
    if (at && at.getTime() > context.now.getTime()) decideBy = at.toISOString();
    else keep(proposal.decide_by_quote);
  }

  for (const part of proposal.unsupported) keep(part);
  return { version: 1, same_tier: sameTier, decide_by: decideBy, unsupported: unsupported.slice(0, 5) };
}

/** When the request ends: the release cutoff, or the fan's own deadline if that is earlier. */
export function effectiveExpiry(cutoff: string | Date, conditions: StandbyConditions | null): Date {
  const end = new Date(cutoff);
  if (!conditions?.decide_by) return end;
  const decideBy = new Date(conditions.decide_by);
  return decideBy.getTime() < end.getTime() ? decideBy : end;
}
