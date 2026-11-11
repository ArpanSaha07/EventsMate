import { describe, expect, it } from "vitest";
import { checkProposal } from "@/lib/policy-proposal";

const TIERS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "General", price_cents: 4500 },
  { id: "22222222-2222-4222-8222-222222222222", name: "VIP", price_cents: 8000 },
];

const POLICY =
  "We refund 85% of what you paid if your seat is resold. VIP seats are refunded at 80% because catering is pre-ordered.";

const base = {
  tier_name: null,
  within_hours_of_start: null,
  refund_percent: 85,
  fee_cents: 0,
  quote: "We refund 85% of what you paid if your seat is resold.",
};
const vip = {
  tier_name: "vip",
  within_hours_of_start: null,
  refund_percent: 80,
  fee_cents: 0,
  quote: "VIP seats are refunded at 80% because catering is pre-ordered.",
};

function problemsOf(raw: unknown, policy = POLICY): string {
  const verdict = checkProposal(raw, policy, TIERS);
  if (verdict.ok) throw new Error("expected the proposal to be rejected");
  return verdict.problems.join(" | ");
}

describe("checkProposal", () => {
  it("accepts a clean reading and resolves tier names to ids", () => {
    const verdict = checkProposal({ clauses: [base, vip], unsupported: [] }, POLICY, TIERS);
    expect(verdict).toEqual({
      ok: true,
      rule: {
        version: 1,
        clauses: [
          { tier_id: null, tier_name: null, within_hours_of_start: null, percent: 85, fee_cents: 0, quote: base.quote },
          { tier_id: TIERS[1].id, tier_name: "VIP", within_hours_of_start: null, percent: 80, fee_cents: 0, quote: vip.quote },
        ],
      },
    });
  });

  it("tolerates whitespace differences in a quote but not different words", () => {
    const spaced = { ...base, quote: "We refund 85%  of what you paid\nif your seat is resold." };
    expect(checkProposal({ clauses: [spaced], unsupported: [] }, POLICY, TIERS).ok).toBe(true);
    const invented = { ...base, quote: "We refund 85% of the ticket price." };
    expect(problemsOf({ clauses: [invented], unsupported: [] })).toMatch(/not a sentence from your policy/);
  });

  it("rejects a tier the event does not have", () => {
    expect(problemsOf({ clauses: [base, { ...vip, tier_name: "Platinum" }], unsupported: [] })).toMatch(/Platinum/);
  });

  it("rejects out-of-range or fractional numbers", () => {
    expect(problemsOf({ clauses: [{ ...base, refund_percent: 120 }], unsupported: [] })).toMatch(/whole percentage/);
    expect(problemsOf({ clauses: [{ ...base, refund_percent: 87.5 }], unsupported: [] })).toMatch(/whole percentage/);
    expect(problemsOf({ clauses: [{ ...base, fee_cents: -100 }], unsupported: [] })).toMatch(/fee/);
    expect(problemsOf({ clauses: [base, { ...base, within_hours_of_start: 0 }], unsupported: [] })).toMatch(/time limit/);
    expect(problemsOf({ clauses: [base, { ...base, within_hours_of_start: 10000 }], unsupported: [] })).toMatch(/time limit/);
  });

  it("requires a fee to be written in the quoted sentence", () => {
    const policy = "If your released seat is resold, you get a full refund minus a $2 processing fee.";
    const clause = { tier_name: null, within_hours_of_start: null, refund_percent: 100, fee_cents: 200, quote: policy };
    expect(checkProposal({ clauses: [clause], unsupported: [] }, policy, TIERS).ok).toBe(true);
    // The model confused dollars and cents, or invented a fee.
    expect(problemsOf({ clauses: [{ ...clause, fee_cents: 2 }], unsupported: [] }, policy)).toMatch(/fee amount/);
    expect(problemsOf({ clauses: [{ ...clause, fee_cents: 500 }], unsupported: [] }, policy)).toMatch(/fee amount/);
  });

  it("rejects a reading with anything left unsupported", () => {
    const text = problemsOf({
      clauses: [base],
      unsupported: [{ quote: "VIP seats are refunded at 80% because catering is pre-ordered.", reason: "Unclear." }],
    });
    expect(text).toMatch(/Could not turn this into a rule/);
  });

  it("requires a general clause", () => {
    const policy = "Within 24 hours of the start the refund is 50%.";
    const windowOnly = { tier_name: null, within_hours_of_start: 24, refund_percent: 50, fee_cents: 0, quote: policy };
    expect(problemsOf({ clauses: [windowOnly], unsupported: [] }, policy)).toMatch(/general case/);
  });

  it("never accepts a clause that pays nothing on resale (D44)", () => {
    const policy = "Full refund up to 24 hours prior to event start.";
    const general = { tier_name: null, within_hours_of_start: null, refund_percent: 100, fee_cents: 0, quote: policy };
    expect(checkProposal({ clauses: [general], unsupported: [] }, policy, TIERS).ok).toBe(true);
    const noRefundWindow = { ...general, within_hours_of_start: 24, refund_percent: 0 };
    expect(problemsOf({ clauses: [general, noRefundWindow], unsupported: [] }, policy)).toMatch(/always pays the holder something/);

    const feePolicy = "Resold seats get half back minus a $40 fee.";
    const swallowed = { tier_name: null, within_hours_of_start: null, refund_percent: 50, fee_cents: 4000, quote: feePolicy };
    expect(problemsOf({ clauses: [swallowed], unsupported: [] }, feePolicy)).toMatch(/would pay nothing for a General ticket/);
  });

  it("treats the same answer given twice as one clause", () => {
    const policy = "Full refund when your seat is resold. No fees.";
    const full = { tier_name: null, within_hours_of_start: null, refund_percent: 100, fee_cents: 0 };
    const verdict = checkProposal(
      {
        clauses: [
          { ...full, quote: "Full refund when your seat is resold." },
          { ...full, quote: "No fees." },
        ],
        unsupported: [],
      },
      policy,
      TIERS,
    );
    expect(verdict.ok && verdict.rule.clauses).toHaveLength(1);
  });

  it("rejects contradictory clauses, empty readings and malformed output", () => {
    expect(problemsOf({ clauses: [base, { ...base, refund_percent: 50 }], unsupported: [] })).toMatch(/two different answers/);
    expect(problemsOf({ clauses: [], unsupported: [] })).toMatch(/No refund rule/);
    expect(problemsOf({ clauses: "all of it" })).toMatch(/unexpected form/);
    expect(problemsOf(null)).toMatch(/unexpected form/);
  });
});
