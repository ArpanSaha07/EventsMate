/**
 * The structured refund rule (F6) and the only code that turns it into money.
 * Pure functions, shared by server and client. Decisions D35, D39, D40, D41.
 */
import { z } from "zod";
import { formatMoney } from "@/lib/money";

export const MAX_WINDOW_HOURS = 30 * 24;
export const MAX_FEE_CENTS = 100_000;
export const MAX_POLICY_LENGTH = 1000;

const HOUR_MS = 60 * 60 * 1000;

export const refundClauseSchema = z.object({
  /** Null: applies to every tier. */
  tier_id: z.uuid().nullable(),
  tier_name: z.string().min(1).max(120).nullable(),
  /** Null: applies at any time. N: applies once the event starts in N hours or less. */
  within_hours_of_start: z.int().min(1).max(MAX_WINDOW_HOURS).nullable(),
  /** Whole percent of the price the holder paid. Never 0: a resold seat always pays something (D44). */
  percent: z.int().min(1).max(100),
  /** Flat fee subtracted after the percentage. */
  fee_cents: z.int().min(0).max(MAX_FEE_CENTS),
  /** The policy sentence this clause came from, verbatim. */
  quote: z.string().min(1).max(MAX_POLICY_LENGTH),
});

export const refundRuleSchema = z.object({
  version: z.literal(1),
  clauses: z.array(refundClauseSchema).min(1).max(12),
});

export type RefundClause = z.infer<typeof refundClauseSchema>;
export type RefundRule = z.infer<typeof refundRuleSchema>;

/** Parses a stored rule. Null when it is missing or not a valid rule. */
export function parseRefundRule(value: unknown): RefundRule | null {
  const parsed = refundRuleSchema.safeParse(value);
  return parsed.success && structuralProblems(parsed.data).length === 0 ? parsed.data : null;
}

/** Problems that make a rule ambiguous, in words an organiser can act on. */
export function structuralProblems(rule: RefundRule): string[] {
  const problems: string[] = [];
  const general = rule.clauses.filter((c) => c.tier_id === null && c.within_hours_of_start === null);
  if (general.length === 0) {
    problems.push(
      "The policy must say what is refunded in the general case (any ticket type, any time before the event).",
    );
  }
  const seen = new Set<string>();
  for (const clause of rule.clauses) {
    if ((clause.tier_id === null) !== (clause.tier_name === null)) {
      problems.push("A clause names a ticket type that could not be identified.");
    }
    const key = `${clause.tier_id ?? "*"}|${clause.within_hours_of_start ?? "*"}`;
    if (seen.has(key)) {
      problems.push(
        `The policy gives two different answers for ${describeScope(clause).toLowerCase()}. Keep one.`,
      );
    }
    seen.add(key);
  }
  return problems;
}

/**
 * D44: clauses that would pay nothing for a ticket type at its current price.
 * Returns one sentence per problem.
 */
export function zeroPayoutProblems(
  rule: RefundRule,
  tiers: { id: string; name: string; price_cents: number }[],
): string[] {
  const problems: string[] = [];
  for (const clause of rule.clauses) {
    for (const tier of tiers) {
      if (clause.tier_id !== null && clause.tier_id !== tier.id) continue;
      if (refundAmountCents(tier.price_cents, clause) <= 0) {
        problems.push(
          `"${describeTerms(clause)}" would pay nothing for a ${tier.name} ticket (${formatMoney(tier.price_cents)}). A resold seat must always pay the holder something.`,
        );
      }
    }
  }
  return problems;
}

/** D41: percentage rounded down to the cent, then the fee, never below zero. */
export function refundAmountCents(
  unitPriceCents: number,
  terms: { percent: number; fee_cents: number },
): number {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw new Error(`Invalid price: ${unitPriceCents}`);
  }
  return Math.max(0, Math.floor((unitPriceCents * terms.percent) / 100) - terms.fee_cents);
}

/**
 * D40: the clause that applies to a seat of this tier resold at `at`.
 * An active time window beats any clause without one; the tightest active
 * window wins; at the same window a tier-specific clause beats a general one.
 */
export function applicableClause(
  rule: RefundRule,
  seat: { tierId: string; startsAt: string | Date },
  at: Date,
): RefundClause {
  const msToStart = new Date(seat.startsAt).getTime() - at.getTime();
  const candidates = rule.clauses.filter(
    (c) =>
      (c.tier_id === null || c.tier_id === seat.tierId) &&
      (c.within_hours_of_start === null || msToStart <= c.within_hours_of_start * HOUR_MS),
  );
  candidates.sort(
    (a, b) =>
      (a.within_hours_of_start ?? Infinity) - (b.within_hours_of_start ?? Infinity) ||
      Number(b.tier_id !== null) - Number(a.tier_id !== null),
  );
  const clause = candidates[0];
  if (!clause) throw new Error("Refund rule has no general clause.");
  return clause;
}

export type RefundPreview = {
  refundCents: number;
  clause: RefundClause;
  /** The next moment the amount changes if the seat is still unsold, if any. */
  next: { at: string; refundCents: number; clause: RefundClause } | null;
};

/**
 * What a holder gets if the seat is resold at `now`, and the next change.
 * `until` bounds the look-ahead (the release cutoff: no resale happens after it).
 */
export function previewRefund(
  rule: RefundRule,
  seat: { tierId: string; unitPriceCents: number; startsAt: string | Date },
  now: Date,
  until?: Date,
): RefundPreview {
  const start = new Date(seat.startsAt).getTime();
  const clause = applicableClause(rule, seat, now);
  const refundCents = refundAmountCents(seat.unitPriceCents, clause);

  const boundaries = [...new Set(rule.clauses.map((c) => c.within_hours_of_start))]
    .filter((hours): hours is number => hours !== null)
    .map((hours) => start - hours * HOUR_MS)
    .filter((t) => t > now.getTime() && (!until || t < until.getTime()))
    .sort((a, b) => a - b);

  let next: RefundPreview["next"] = null;
  for (const t of boundaries) {
    const later = applicableClause(rule, seat, new Date(t));
    const laterCents = refundAmountCents(seat.unitPriceCents, later);
    if (laterCents !== refundCents) {
      next = { at: new Date(t).toISOString(), refundCents: laterCents, clause: later };
      break;
    }
  }
  return { refundCents, clause, next };
}

/** "Full refund", "90% of the price paid, minus a $2.00 fee". */
export function describeTerms(terms: { percent: number; fee_cents: number }): string {
  const base = terms.percent === 100 ? "Full refund" : `${terms.percent}% of the price paid`;
  return terms.fee_cents > 0 ? `${base}, minus a ${formatMoney(terms.fee_cents)} fee` : base;
}

/** "All tickets, any time", "VIP, within 24 hours of the start". */
export function describeScope(clause: Pick<RefundClause, "tier_name" | "within_hours_of_start">): string {
  const who = clause.tier_name ?? "All tickets";
  const hours = clause.within_hours_of_start;
  if (hours === null) return `${who}, any time`;
  return `${who}, within ${hours} hour${hours === 1 ? "" : "s"} of the start`;
}
