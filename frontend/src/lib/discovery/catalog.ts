/**
 * Pure helpers for the Plan with AI chat. The model sees the catalog built here and
 * proposes event refs; `resolveSelection` re-checks everything against the real rows.
 * No server imports, so this is unit-testable.
 */
import { z } from "zod";
import { formatEventDay, formatEventTimeRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { isSoldOut, seatsLeft } from "@/lib/rules";
import type { EventWithTiers, Tier } from "@/lib/types";
import type { BudgetSummary } from "@/lib/discovery/types";

/** What the model returns. Every field is required so strict structured output accepts it. */
export const selectionSchema = z.object({
  intent: z.enum(["discover", "my_tickets", "upcoming", "standby_status", "other"]),
  /** Catalog refs ("E3") of every event that matches the request, best match first. */
  event_refs: z.array(z.string()),
  /** "sold_out" / "available" only when the user asked for exactly that. */
  availability: z.enum(["any", "available", "sold_out"]),
  /** Price cap for one ticket, in cents. */
  max_price_cents: z.number().int().nullable(),
  /** Cap for the combined price of one ticket to each suggested event, in cents. */
  total_budget_cents: z.number().int().nullable(),
  /** One or two sentences answering the user. */
  reply: z.string(),
});

export type Selection = z.infer<typeof selectionSchema>;

export type ResolvedSelection = {
  /** Events with at least one tier on sale. */
  available: EventWithTiers[];
  /** Events where every tier is sold out. */
  soldOut: EventWithTiers[];
  budgetSummary?: BudgetSummary;
};

/** True when no tier has a seat left. */
export function isEventSoldOut(event: EventWithTiers): boolean {
  return event.ticket_tiers.length === 0 || event.ticket_tiers.every(isSoldOut);
}

/** The cheapest tier still on sale, or the cheapest tier overall when sold out. */
export function getLowestTier(event: EventWithTiers): Tier | null {
  if (event.ticket_tiers.length === 0) return null;
  const onSale = event.ticket_tiers.filter((t) => !isSoldOut(t));
  const pool = onSale.length > 0 ? onSale : event.ticket_tiers;
  return [...pool].sort((a, b) => a.price_cents - b.price_cents)[0] ?? null;
}

export function refFor(index: number): string {
  return `E${index + 1}`;
}

/** One line per event, with live prices and seats, for the model to choose from. */
export function buildCatalog(events: EventWithTiers[]): string {
  if (events.length === 0) return "(no upcoming events)";
  return events
    .map((event, index) => {
      const tiers = event.ticket_tiers
        .map((t) =>
          isSoldOut(t)
            ? `${t.name} ${formatMoney(t.price_cents)} (SOLD OUT)`
            : `${t.name} ${formatMoney(t.price_cents)} (${seatsLeft(t)} left)`,
        )
        .join("; ");
      return [
        refFor(index),
        event.title,
        `category: ${event.category}`,
        `${formatEventDay(event.starts_at, event.timezone)}, ${formatEventTimeRange(event.starts_at, event.ends_at, event.timezone)}`,
        `${event.venue}, ${event.city}`,
        `status: ${isEventSoldOut(event) ? "SOLD OUT" : "TICKETS AVAILABLE"}`,
        `tiers: ${tiers}`,
        `about: ${event.description}`,
        `refund policy: ${event.refund_policy_text}`,
      ].join(" | ");
    })
    .join("\n");
}

/**
 * Turns the model's proposal into real events. Unknown refs are dropped, sold-out status
 * and prices come from the rows, and budgets are enforced here rather than trusted.
 */
export function resolveSelection(events: EventWithTiers[], selection: Selection): ResolvedSelection {
  const byRef = new Map(events.map((event, index) => [refFor(index), event]));
  const seen = new Set<string>();
  const picked: EventWithTiers[] = [];
  for (const raw of selection.event_refs) {
    const event = byRef.get(raw.trim().toUpperCase());
    if (event && !seen.has(event.id)) {
      seen.add(event.id);
      picked.push(event);
    }
  }

  const cap = selection.max_price_cents;
  let available = picked.filter((e) => !isEventSoldOut(e));
  let soldOut = picked.filter((e) => isEventSoldOut(e));
  if (cap !== null && cap >= 0) {
    available = available.filter((e) => e.ticket_tiers.some((t) => !isSoldOut(t) && t.price_cents <= cap));
    soldOut = soldOut.filter((e) => e.ticket_tiers.some((t) => t.price_cents <= cap));
  }
  if (selection.availability === "available") soldOut = [];
  if (selection.availability === "sold_out") available = [];

  let budgetSummary: BudgetSummary | undefined;
  const budget = selection.total_budget_cents;
  if (budget !== null && budget >= 0 && available.length > 0) {
    const price = (e: EventWithTiers) => getLowestTier(e)?.price_cents ?? 0;
    // Keep the model's ranking, dropping the lowest-ranked events until the total fits.
    const kept = [...available];
    while (kept.length > 0 && kept.reduce((sum, e) => sum + price(e), 0) > budget) kept.pop();
    available = kept;
    if (kept.length > 0) {
      const total = kept.reduce((sum, e) => sum + price(e), 0);
      budgetSummary = {
        breakdown: `${kept.map((e) => formatMoney(price(e))).join(" + ")} = ${formatMoney(total)} of your ${formatMoney(budget)}`,
        totalSpentCents: total,
        budgetCents: budget,
      };
    }
  }

  return { available, soldOut, budgetSummary };
}

const STOP_WORDS = new Set([
  "the", "and", "for", "all", "any", "are", "you", "can", "show", "find", "give", "tell", "about",
  "share", "suggest", "some", "with", "what", "which", "that", "this", "have", "has", "event",
  "events", "ticket", "tickets", "available", "sold", "out", "please", "want", "need", "list",
  "there", "more", "from", "night", "upcoming",
]);

/** Keyword selection used only when the model call fails. */
export function fallbackSelect(text: string, events: EventWithTiers[]): Selection {
  const lower = text.toLowerCase();
  const words = (lower.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  const scored = events.map((event, index) => {
    const title = new Set(event.title.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const rest = new Set(
      `${event.description} ${event.category} ${event.venue}`.toLowerCase().match(/[a-z0-9]+/g) ?? [],
    );
    const hits = (w: string, set: Set<string>) => set.has(w) || set.has(`${w}s`) || set.has(w.replace(/s$/, ""));
    const score = words.reduce((sum, w) => sum + (hits(w, title) ? 3 : hits(w, rest) ? 1 : 0), 0);
    return { ref: refFor(index), score };
  });

  const best = Math.max(0, ...scored.map((s) => s.score));
  // No keyword hit means a broad request ("what's on?"): offer the whole catalog.
  const refs = best === 0 ? scored.map((s) => s.ref) : scored.filter((s) => s.score === best).map((s) => s.ref);

  const price = lower.match(/\$\s?(\d+)/);
  return {
    intent: "discover",
    event_refs: refs,
    availability: /sold[\s-]?out|full\b/.test(lower) ? "sold_out" : "any",
    max_price_cents: lower.includes("free") ? 0 : price ? parseInt(price[1], 10) * 100 : null,
    total_budget_cents: null,
    reply: "",
  };
}
