"use client";

import { formatMoment } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  describeScope,
  describeTerms,
  previewRefund,
  type RefundRule,
} from "@/lib/refund-rule";
import { releaseCutoff } from "@/lib/rules";

type Tier = { id: string; name: string; price_cents: number };

/** Each clause in plain words with the policy sentence it came from. */
export function RuleClauses({ rule }: { rule: RefundRule }) {
  return (
    <ul className="space-y-2">
      {rule.clauses.map((clause, index) => (
        <li key={index} className="rounded-lg border bg-background px-3 py-2 text-sm">
          <p>
            <span className="text-muted-foreground">{describeScope(clause)}: </span>
            <span className="font-medium">{describeTerms(clause)}</span>
          </p>
          <p className="mt-0.5 text-muted-foreground">From: “{clause.quote}”</p>
        </li>
      ))}
    </ul>
  );
}

/** What a holder of each tier gets back if the seat is resold now, and when that changes. */
export function RefundExamples({
  rule,
  tiers,
  startsAt,
  timezone,
  now,
}: {
  rule: RefundRule;
  tiers: Tier[];
  startsAt: string;
  timezone: string;
  now: Date;
}) {
  const cutoff = releaseCutoff(startsAt);
  return (
    <ul className="divide-y rounded-lg border bg-background text-sm">
      {tiers.map((tier) => {
        const preview = previewRefund(
          rule,
          { tierId: tier.id, unitPriceCents: tier.price_cents, startsAt },
          now,
          cutoff,
        );
        return (
          <li key={tier.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
            <span>
              {tier.name} <span className="text-muted-foreground">({formatMoney(tier.price_cents)})</span>
            </span>
            <span className="text-right">
              <span className="font-semibold tabular-nums">{formatMoney(preview.refundCents)}</span>
              <span className="text-muted-foreground"> if resold now</span>
              {preview.next && (
                <span className="block text-muted-foreground">
                  {formatMoney(preview.next.refundCents)} from {formatMoment(preview.next.at, timezone)}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
