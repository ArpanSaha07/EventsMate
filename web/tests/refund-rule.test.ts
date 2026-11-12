import { describe, expect, it } from "vitest";
import {
  applicableClause,
  describeScope,
  describeTerms,
  parseRefundRule,
  previewRefund,
  refundAmountCents,
  structuralProblems,
  zeroPayoutProblems,
  type RefundClause,
  type RefundRule,
} from "@/lib/refund-rule";

const GENERAL = "11111111-1111-4111-8111-111111111111";
const VIP = "22222222-2222-4222-8222-222222222222";
const START = "2026-11-18T10:00:00-08:00";
const at = (iso: string) => new Date(iso);

function clause(partial: Partial<RefundClause>): RefundClause {
  return {
    tier_id: null,
    tier_name: null,
    within_hours_of_start: null,
    percent: 100,
    fee_cents: 0,
    quote: "q",
    ...partial,
  };
}

const rule = (...clauses: RefundClause[]): RefundRule => ({ version: 1, clauses });

describe("refundAmountCents", () => {
  it("rounds the percentage down to the cent (D41)", () => {
    expect(refundAmountCents(1750, { percent: 85, fee_cents: 0 })).toBe(1487); // 1487.5
    expect(refundAmountCents(3333, { percent: 50, fee_cents: 0 })).toBe(1666); // 1666.5
    expect(refundAmountCents(3000, { percent: 90, fee_cents: 0 })).toBe(2700);
  });

  it("subtracts the fee after the percentage and never goes below zero", () => {
    expect(refundAmountCents(3500, { percent: 100, fee_cents: 200 })).toBe(3300);
    expect(refundAmountCents(1000, { percent: 50, fee_cents: 200 })).toBe(300);
    expect(refundAmountCents(100, { percent: 100, fee_cents: 200 })).toBe(0);
    expect(refundAmountCents(5000, { percent: 0, fee_cents: 100 })).toBe(0);
  });

  it("never refunds more than was paid", () => {
    for (const price of [0, 1, 99, 1500, 8000]) {
      for (const percent of [0, 1, 33, 99, 100]) {
        const cents = refundAmountCents(price, { percent, fee_cents: 0 });
        expect(cents).toBeLessThanOrEqual(price);
        expect(Number.isInteger(cents)).toBe(true);
      }
    }
  });

  it("refuses a price that is not whole cents", () => {
    expect(() => refundAmountCents(10.5, { percent: 100, fee_cents: 0 })).toThrow();
    expect(() => refundAmountCents(-1, { percent: 100, fee_cents: 0 })).toThrow();
  });
});

describe("applicableClause (D40)", () => {
  const r = rule(
    clause({ percent: 90, quote: "base" }),
    clause({ tier_id: VIP, tier_name: "VIP", percent: 80, quote: "vip" }),
    clause({ within_hours_of_start: 24, percent: 75, quote: "24h" }),
    clause({ within_hours_of_start: 6, percent: 10, quote: "6h" }),
  );

  it("uses the general clause outside every window", () => {
    expect(applicableClause(r, { tierId: GENERAL, startsAt: START }, at("2026-11-16T10:00:00-08:00")).quote).toBe("base");
  });

  it("prefers a tier clause over the general one", () => {
    expect(applicableClause(r, { tierId: VIP, startsAt: START }, at("2026-11-16T10:00:00-08:00")).quote).toBe("vip");
  });

  it("lets an active time window beat a tier clause", () => {
    expect(applicableClause(r, { tierId: VIP, startsAt: START }, at("2026-11-17T12:00:00-08:00")).quote).toBe("24h");
  });

  it("uses the tightest active window", () => {
    expect(applicableClause(r, { tierId: GENERAL, startsAt: START }, at("2026-11-18T05:00:00-08:00")).quote).toBe("6h");
  });

  it("starts a window exactly N hours before the start", () => {
    expect(applicableClause(r, { tierId: GENERAL, startsAt: START }, at("2026-11-17T09:59:59-08:00")).quote).toBe("base");
    expect(applicableClause(r, { tierId: GENERAL, startsAt: START }, at("2026-11-17T10:00:00-08:00")).quote).toBe("24h");
  });

  it("prefers a tier-specific window over a general window of the same length", () => {
    const both = rule(
      clause({ quote: "base" }),
      clause({ within_hours_of_start: 24, percent: 50, quote: "24h" }),
      clause({ tier_id: VIP, tier_name: "VIP", within_hours_of_start: 24, percent: 20, quote: "vip24h" }),
    );
    const when = at("2026-11-17T20:00:00-08:00");
    expect(applicableClause(both, { tierId: VIP, startsAt: START }, when).quote).toBe("vip24h");
    expect(applicableClause(both, { tierId: GENERAL, startsAt: START }, when).quote).toBe("24h");
  });

  it("ignores clauses for other tiers", () => {
    const other = rule(clause({ quote: "base" }), clause({ tier_id: VIP, tier_name: "VIP", within_hours_of_start: 24, percent: 10, quote: "vip24h" }));
    expect(applicableClause(other, { tierId: GENERAL, startsAt: START }, at("2026-11-18T00:00:00-08:00")).quote).toBe("base");
  });
});

describe("previewRefund (D35)", () => {
  const r = rule(clause({ percent: 90, quote: "base" }), clause({ within_hours_of_start: 24, percent: 75, quote: "24h" }));
  const seat = { tierId: GENERAL, unitPriceCents: 3000, startsAt: START };

  it("shows the amount now and the next change", () => {
    const preview = previewRefund(r, seat, at("2026-11-15T10:00:00-08:00"));
    expect(preview.refundCents).toBe(2700);
    expect(preview.next).toMatchObject({ refundCents: 2250 });
    expect(preview.next?.at).toBe(new Date("2026-11-17T10:00:00-08:00").toISOString());
  });

  it("has no next change once inside the last window", () => {
    const preview = previewRefund(r, seat, at("2026-11-17T12:00:00-08:00"));
    expect(preview.refundCents).toBe(2250);
    expect(preview.next).toBeNull();
  });

  it("ignores changes at or after the release cutoff", () => {
    const late = rule(clause({ quote: "base" }), clause({ within_hours_of_start: 1, percent: 10, quote: "1h" }));
    const cutoff = at("2026-11-18T08:00:00-08:00");
    expect(previewRefund(late, seat, at("2026-11-15T10:00:00-08:00"), cutoff).next).toBeNull();
  });

  it("skips a boundary that does not change the amount for this tier", () => {
    const vipOnly = rule(clause({ quote: "base" }), clause({ tier_id: VIP, tier_name: "VIP", within_hours_of_start: 24, percent: 10, quote: "vip24h" }));
    expect(previewRefund(vipOnly, seat, at("2026-11-15T10:00:00-08:00")).next).toBeNull();
  });
});

describe("rule structure", () => {
  it("requires a general clause", () => {
    const problems = structuralProblems(rule(clause({ within_hours_of_start: 24, percent: 50 })));
    expect(problems.join(" ")).toMatch(/general case/);
  });

  it("rejects two answers for the same scope", () => {
    expect(structuralProblems(rule(clause({ percent: 90 }), clause({ percent: 80 }))).length).toBe(1);
  });

  it("parses a valid stored rule and rejects anything else", () => {
    const good = rule(clause({ percent: 90 }));
    expect(parseRefundRule(good)).toEqual(good);
    expect(parseRefundRule(null)).toBeNull();
    expect(parseRefundRule({ version: 2, clauses: good.clauses })).toBeNull();
    expect(parseRefundRule(rule(clause({ percent: 101 })))).toBeNull();
    expect(parseRefundRule(rule(clause({ percent: 0 })))).toBeNull(); // D44: resale always pays
    expect(parseRefundRule(rule(clause({ percent: 12.5 })))).toBeNull();
    expect(parseRefundRule(rule(clause({ fee_cents: -1 })))).toBeNull();
    expect(parseRefundRule(rule(clause({ within_hours_of_start: 24 })))).toBeNull(); // no general clause
  });
});

describe("zeroPayoutProblems (D44)", () => {
  const tiers = [
    { id: GENERAL, name: "General", price_cents: 1500 },
    { id: VIP, name: "VIP", price_cents: 6000 },
  ];

  it("accepts a rule that pays something for every tier", () => {
    expect(zeroPayoutProblems(rule(clause({ percent: 100, fee_cents: 100 })), tiers)).toEqual([]);
  });

  it("flags a fee that swallows the refund for a cheap tier only", () => {
    const problems = zeroPayoutProblems(rule(clause({ percent: 50, fee_cents: 750 })), tiers);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/General/);
  });

  it("checks a tier clause only against its own tier", () => {
    const r = rule(clause({ percent: 100 }), clause({ tier_id: VIP, tier_name: "VIP", percent: 10, fee_cents: 1000 }));
    expect(zeroPayoutProblems(r, tiers)).toHaveLength(1);
  });
});

describe("plain words", () => {
  it("describes terms", () => {
    expect(describeTerms({ percent: 100, fee_cents: 0 })).toBe("Full refund");
    expect(describeTerms({ percent: 100, fee_cents: 200 })).toBe("Full refund, minus a $2.00 fee");
    expect(describeTerms({ percent: 85, fee_cents: 0 })).toBe("85% of the price paid");
  });

  it("describes scope", () => {
    expect(describeScope({ tier_name: null, within_hours_of_start: null })).toBe("All tickets, any time");
    expect(describeScope({ tier_name: "VIP", within_hours_of_start: 24 })).toBe("VIP, within 24 hours of the start");
  });
});
