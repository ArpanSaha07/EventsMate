/**
 * Deterministic check of what the model read from a refund policy (F6).
 * The model proposes; this code decides whether the proposal may be shown to
 * the organiser for confirmation. Pure: no network, no database.
 */
import { z } from "zod";
import {
  MAX_FEE_CENTS,
  MAX_WINDOW_HOURS,
  structuralProblems,
  zeroPayoutProblems,
  type RefundClause,
  type RefundRule,
} from "@/lib/refund-rule";

/** The JSON the model must return (strict structured output: every field required). */
export const policyProposalSchema = z.object({
  clauses: z.array(
    z.object({
      tier_name: z.string().nullable(),
      within_hours_of_start: z.number().nullable(),
      refund_percent: z.number(),
      fee_cents: z.number(),
      quote: z.string(),
    }),
  ),
  unsupported: z.array(z.object({ quote: z.string(), reason: z.string() })),
});

export type PolicyProposal = z.infer<typeof policyProposalSchema>;

export type ProposalVerdict =
  | { ok: true; rule: RefundRule }
  | { ok: false; problems: string[] };

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const clip = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}...` : text);

/** True if the fee, written in digits as dollars, appears in the quoted sentence. */
function feeAppearsIn(quote: string, feeCents: number): boolean {
  const numbers = quote.match(/\d+(?:\.\d+)?/g) ?? [];
  return numbers.some((n) => Math.round(Number(n) * 100) === feeCents);
}

/**
 * Accepts a proposal only if every clause is in range, names a real tier of
 * this event, and quotes the policy verbatim; and the rule as a whole is
 * unambiguous and leaves no sentence unexplained.
 */
export function checkProposal(
  raw: unknown,
  policyText: string,
  tiers: { id: string; name: string; price_cents: number }[],
): ProposalVerdict {
  const parsed = policyProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, problems: ["The reading came back in an unexpected form. Please read the policy again."] };
  }
  const proposal = parsed.data;
  const policy = squash(policyText);
  const problems: string[] = [];

  for (const item of proposal.unsupported) {
    const quote = squash(item.quote);
    problems.push(
      quote
        ? `Could not turn this into a rule: "${clip(quote)}" ${squash(item.reason)}`
        : squash(item.reason) || "Part of the policy could not be turned into a rule.",
    );
  }

  if (proposal.clauses.length === 0 && problems.length === 0) {
    problems.push("No refund rule was found in this text. Say what a holder gets back when their seat is resold.");
  }
  if (proposal.clauses.length > 12) {
    problems.push("This policy has too many separate rules. Simplify it to 12 or fewer.");
  }

  const clauses: RefundClause[] = [];
  for (const c of proposal.clauses.slice(0, 12)) {
    const quote = squash(c.quote);
    const label = quote ? `"${clip(quote)}"` : "A clause";

    if (!quote || !policy.includes(quote)) {
      problems.push(`${label} is not a sentence from your policy, so it was not used. Please read the policy again.`);
      continue;
    }

    let tier: { id: string; name: string; price_cents: number } | null = null;
    if (c.tier_name !== null) {
      const wanted = squash(c.tier_name).toLowerCase();
      tier = tiers.find((t) => t.name.toLowerCase() === wanted) ?? null;
      if (!tier) {
        problems.push(
          `${label} names a ticket type "${squash(c.tier_name)}" that this event does not have (it has: ${tiers.map((t) => t.name).join(", ")}).`,
        );
        continue;
      }
    }

    if (c.refund_percent === 0) {
      problems.push(
        `${label}: a resold seat always pays the holder something, so a resale rule cannot be "no refund". Limits on ordinary refunds do not need to be in this rule.`,
      );
      continue;
    }
    if (!Number.isInteger(c.refund_percent) || c.refund_percent < 1 || c.refund_percent > 100) {
      problems.push(`${label}: the refund must be a whole percentage from 1 to 100.`);
      continue;
    }
    if (!Number.isInteger(c.fee_cents) || c.fee_cents < 0 || c.fee_cents > MAX_FEE_CENTS) {
      problems.push(`${label}: the fee must be between $0 and $${MAX_FEE_CENTS / 100}.`);
      continue;
    }
    if (c.fee_cents > 0 && !feeAppearsIn(quote, c.fee_cents)) {
      problems.push(`${label}: the fee amount could not be found in that sentence. Write fees in digits, for example "$2".`);
      continue;
    }
    const hours = c.within_hours_of_start;
    if (hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > MAX_WINDOW_HOURS)) {
      problems.push(`${label}: a time limit must be a whole number of hours before the start, up to 30 days.`);
      continue;
    }

    // The same answer given twice for the same scope (for example from "Full
    // refund. No fees.") is one clause, not a contradiction.
    const tierId = tier?.id ?? null;
    const repeat = clauses.some(
      (k) =>
        k.tier_id === tierId &&
        k.within_hours_of_start === hours &&
        k.percent === c.refund_percent &&
        k.fee_cents === c.fee_cents,
    );
    if (repeat) continue;

    clauses.push({
      tier_id: tier?.id ?? null,
      tier_name: tier?.name ?? null,
      within_hours_of_start: hours,
      percent: c.refund_percent,
      fee_cents: c.fee_cents,
      quote,
    });
  }

  if (clauses.length > 0) {
    problems.push(...structuralProblems({ version: 1, clauses }));
    problems.push(...zeroPayoutProblems({ version: 1, clauses }, tiers));
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };
  return { ok: true, rule: { version: 1, clauses } };
}
