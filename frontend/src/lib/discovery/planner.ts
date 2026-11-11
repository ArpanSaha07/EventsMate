import "server-only";
import { formatEventDay, formatEventTimeRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { Profile } from "@/lib/session";
import { listMyStandbyRequests } from "@/lib/standby";
import { listMyTickets } from "@/lib/tickets";
import type { EventWithTiers, MyStandbyRequest, MyTicket, Tier } from "@/lib/types";
import { getOpenAIClient, getOpenAIModel } from "@/lib/discovery/openai";
import type {
  ActionProposal,
  BudgetSummary,
  ChatMessage,
  GroupedTicketItem,
  PlanApiResponse,
  PlannerIntent,
  SessionPreferences,
  StandbyStatusItem,
  UpcomingSchedulePayload,
  UserTicketsPayload,
} from "@/lib/discovery/types";

export type ExtractedConstraints = {
  intent?: PlannerIntent;
  topics?: string[];
  category?: string;
  dateType?: "weekend" | "today" | "tomorrow" | "friday_evening" | "this_week" | "any";
  targetDayOfWeek?: number; // 0=Sunday, 6=Saturday
  totalBudgetCents?: number | null;
  perTicketBudgetCents?: number | null;
  count?: number | null;
  freeOnly?: boolean;
  followUpIntent?: "cheaper" | "different" | "filter_date" | "filter_category" | null;
  needsClarification?: boolean;
  clarifyingQuestion?: string | null;
  assumptions?: string | null;
};

/** Get local time details in a specific timezone (defaults to America/Los_Angeles). */
export function getNowInTimezone(tz = "America/Los_Angeles"): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
  hours: number;
  dateStr: string;
} {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });

  const parts = dtf.formatToParts(now);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  let day = now.getUTCDate();
  let weekdayStr = "Wed";
  let hours = 12;

  for (const part of parts) {
    if (part.type === "year") year = parseInt(part.value, 10);
    if (part.type === "month") month = parseInt(part.value, 10);
    if (part.type === "day") day = parseInt(part.value, 10);
    if (part.type === "weekday") weekdayStr = part.value;
    if (part.type === "hour") hours = parseInt(part.value, 10);
  }

  const daysMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = daysMap[weekdayStr] ?? 3;
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return { year, month, day, dayOfWeek, hours, dateStr };
}

/** Format relative human-readable time to an event start. */
export function formatHowSoon(startsAtIso: string, endsAtIso: string, now: Date): string {
  const start = new Date(startsAtIso).getTime();
  const end = new Date(endsAtIso).getTime();
  const nowMs = now.getTime();

  if (start <= nowMs && nowMs < end) {
    return "Happening now";
  }

  const diffMs = start - nowMs;
  if (diffMs <= 0) return "Started";

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffHours < 1) return "in less than an hour";
  if (diffHours === 1) return "in 1 hour";
  if (diffHours < 24) return `in ${diffHours} hours`;
  if (diffDays === 1) return "tomorrow";
  return `in ${diffDays} days`;
}

/** Check if an event matches a relative date constraint in its local timezone. */
export function matchesDateConstraint(
  eventStartsAtIso: string,
  eventTimezone: string,
  dateType?: ExtractedConstraints["dateType"],
  targetDayOfWeek?: number,
): boolean {
  if (!dateType || dateType === "any") return true;

  const eventDate = new Date(eventStartsAtIso);
  const eventDtf = new Intl.DateTimeFormat("en-US", {
    timeZone: eventTimezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });

  const parts = eventDtf.formatToParts(eventDate);
  let evYear = 0;
  let evMonth = 0;
  let evDay = 0;
  let evWeekday = "Wed";
  let evHour = 0;

  for (const p of parts) {
    if (p.type === "year") evYear = parseInt(p.value, 10);
    if (p.type === "month") evMonth = parseInt(p.value, 10);
    if (p.type === "day") evDay = parseInt(p.value, 10);
    if (p.type === "weekday") evWeekday = p.value;
    if (p.type === "hour") evHour = parseInt(p.value, 10);
  }

  const daysMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const evDayOfWeek = daysMap[evWeekday] ?? 0;

  if (targetDayOfWeek !== undefined && evDayOfWeek !== targetDayOfWeek) {
    return false;
  }

  const nowTz = getNowInTimezone(eventTimezone);

  if (dateType === "today") {
    return evYear === nowTz.year && evMonth === nowTz.month && evDay === nowTz.day;
  }

  if (dateType === "tomorrow") {
    const diffDays = Math.round(
      (new Date(evYear, evMonth - 1, evDay).getTime() -
        new Date(nowTz.year, nowTz.month - 1, nowTz.day).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return diffDays === 1;
  }

  if (dateType === "weekend") {
    return evDayOfWeek === 0 || evDayOfWeek === 6;
  }

  if (dateType === "friday_evening") {
    return evDayOfWeek === 5 && evHour >= 17;
  }

  if (dateType === "this_week") {
    const diffDays = Math.round(
      (new Date(evYear, evMonth - 1, evDay).getTime() -
        new Date(nowTz.year, nowTz.month - 1, nowTz.day).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return diffDays >= 0 && diffDays <= 7;
  }

  return true;
}

/** Lowest available ticket tier price in cents, or lowest overall tier price. */
export function getLowestTier(event: EventWithTiers): Tier | null {
  if (!event.ticket_tiers || event.ticket_tiers.length === 0) return null;
  const available = event.ticket_tiers.filter((t) => t.sold_count < t.capacity);
  const pool = available.length > 0 ? available : event.ticket_tiers;
  return [...pool].sort((a, b) => a.price_cents - b.price_cents)[0] ?? null;
}

/** Check if all tiers of an event are sold out. */
export function isEventSoldOut(event: EventWithTiers): boolean {
  if (!event.ticket_tiers || event.ticket_tiers.length === 0) return true;
  return event.ticket_tiers.every((t) => t.sold_count >= t.capacity);
}

/** Deterministic topic scoring for ranking. */
export function calculateRelevanceScore(event: EventWithTiers, topics: string[] = []): number {
  if (topics.length === 0) return 1;
  let score = 0;
  const searchable = `${event.title} ${event.description} ${event.category} ${event.venue} ${event.ticket_tiers
    .map((t) => `${t.name} ${t.description}`)
    .join(" ")}`.toLowerCase();

  for (const topic of topics) {
    const t = topic.toLowerCase().trim();
    if (!t) continue;
    if (searchable.includes(t)) {
      score += 5;
    }
    const words = t.split(/\s+/);
    for (const w of words) {
      if (w.length >= 3 && searchable.includes(w)) {
        score += 2;
      }
    }
  }
  return score;
}

/** Keyword fallback intent classifier that never routes discover requests to data handlers. */
export function fallbackClassifyIntent(text: string): PlannerIntent {
  const lower = text.toLowerCase().trim();

  // my_tickets keywords
  if (
    lower.includes("my ticket") ||
    lower.includes("my tickets") ||
    lower.includes("tickets do i have") ||
    lower.includes("tickets i have") ||
    lower.includes("what did i buy") ||
    lower.includes("tickets have i bought") ||
    lower.includes("show my ticket") ||
    lower.includes("payment go through") ||
    lower.includes("tickets i bought")
  ) {
    return "my_tickets";
  }

  // upcoming personal schedule keywords
  if (
    lower.includes("attend next") ||
    lower.includes("event is next") ||
    lower.includes("event should i attend") ||
    lower.includes("which event is next") ||
    lower.includes("coming up for me") ||
    lower.includes("what's next for me") ||
    lower.includes("whats next for me") ||
    lower.includes("my schedule") ||
    lower.includes("do i have this week") ||
    lower.includes("what do i have")
  ) {
    return "upcoming";
  }

  // standby_status keywords
  if (
    lower.includes("my standby") ||
    lower.includes("standby status") ||
    lower.includes("on standby") ||
    lower.includes("my waitlist") ||
    lower.includes("with my standby")
  ) {
    return "standby_status";
  }

  // General small talk
  if (lower === "hello" || lower === "hi" || lower === "hey" || lower === "who are you") {
    return "other";
  }

  // Default to discover (safe: never sends to data handlers)
  return "discover";
}

/** Fallback regex/keyword extraction if LLM call is unavailable. */
export function fallbackExtract(text: string, prefs: SessionPreferences): ExtractedConstraints {
  const intent = fallbackClassifyIntent(text);
  const lower = text.toLowerCase();
  const countMatch = lower.match(/\b(two|2)\b/);
  const count = countMatch ? 2 : lower.match(/\b(three|3)\b/) ? 3 : lower.match(/\b(one|1)\b/) ? 1 : prefs.count ?? null;
  const budgetMatch = lower.match(/\$(\d+)/);
  const totalBudgetCents = budgetMatch ? parseInt(budgetMatch[1], 10) * 100 : prefs.totalBudgetCents ?? null;
  const freeOnly = lower.includes("free");
  const isWeekend = lower.includes("weekend");
  const isSaturday = lower.includes("saturday");

  return {
    intent,
    topics: lower.includes("ai") ? ["AI", "workshop"] : prefs.topics ?? [],
    category: lower.includes("workshop") ? "Workshop" : lower.includes("meetup") ? "Meetup" : prefs.category,
    dateType: isWeekend ? "weekend" : "any",
    targetDayOfWeek: isSaturday ? 6 : undefined,
    count,
    totalBudgetCents,
    freeOnly,
    followUpIntent: lower.includes("cheaper") ? "cheaper" : lower.includes("something else") ? "different" : null,
  };
}

/** Extract structured constraints and classify intent using OpenAI function calling or JSON mode. */
export async function extractConstraints(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  currentPreferences: SessionPreferences = {},
): Promise<ExtractedConstraints> {
  const nowTz = getNowInTimezone("America/Los_Angeles");

  const systemPrompt = `You are the event discovery and schedule assistant for EventsMate.
Current Date in San Francisco (America/Los_Angeles): ${nowTz.dateStr} (Day of week: ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][nowTz.dayOfWeek]}).

Your job is to parse the user's latest query and conversation history into:
1. "intent": One of:
   - "discover": Searching, finding, browsing, or asking to buy events ("find me events", "any workshops", "make it cheaper", "only saturday").
   - "my_tickets": Asking about tickets they already bought ("what tickets do I have", "show my tickets", "did my payment go through", "what did I buy").
   - "upcoming": Asking what event they should attend next or their upcoming schedule ("which event is next", "what's coming up for me", "what do I have this week").
   - "standby_status": Asking about their standby requests or holds ("what's happening with my standby", "check my standby", "status of my hold").
   - "other": General greeting, small talk, or incomprehensible request.
   Important: Keep previous intent for follow-ups in context (e.g. if previous message was about upcoming tickets, "and next week?" remains "upcoming").

2. Search constraints (when intent is "discover"):
   - topics: string[]
   - category: string | null ("Workshop", "Meetup", "Hackathon")
   - dateType: "weekend" | "today" | "tomorrow" | "friday_evening" | "this_week" | "any"
   - targetDayOfWeek: number | null (0=Sun, 6=Sat)
   - totalBudgetCents: integer cents (e.g. $40 -> 4000)
   - perTicketBudgetCents: integer cents
   - count: integer number of events requested
   - freeOnly: boolean
   - followUpIntent: "cheaper" | "different" | "filter_date" | "filter_category" | null
   - needsClarification: boolean
   - clarifyingQuestion: string | null
   - assumptions: string | null

Return a valid JSON object matching this schema.`;

  try {
    const client = getOpenAIClient();
    const model = getOpenAIModel();
    const response = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "system",
          content: `Previous session preferences: ${JSON.stringify(currentPreferences)}`,
        },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);

    const validIntents: PlannerIntent[] = [
      "discover",
      "my_tickets",
      "upcoming",
      "standby_status",
      "other",
    ];
    const rawIntent = parsed.intent;
    const intent: PlannerIntent = validIntents.includes(rawIntent) ? rawIntent : "discover";

    return {
      intent,
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      category: typeof parsed.category === "string" ? parsed.category : undefined,
      dateType: parsed.dateType ?? "any",
      targetDayOfWeek: typeof parsed.targetDayOfWeek === "number" ? parsed.targetDayOfWeek : undefined,
      totalBudgetCents: typeof parsed.totalBudgetCents === "number" ? parsed.totalBudgetCents : null,
      perTicketBudgetCents: typeof parsed.perTicketBudgetCents === "number" ? parsed.perTicketBudgetCents : null,
      count: typeof parsed.count === "number" ? parsed.count : null,
      freeOnly: Boolean(parsed.free_only ?? parsed.freeOnly),
      followUpIntent: parsed.followUpIntent ?? null,
      needsClarification: Boolean(parsed.needsClarification),
      clarifyingQuestion: parsed.clarifyingQuestion ?? null,
      assumptions: parsed.assumptions ?? null,
    };
  } catch (err) {
    console.error("OpenAI constraint extraction error:", err);
    const lastUserMsg = messages.filter((m) => m.role === "user").slice(-1)[0]?.content || "";
    return fallbackExtract(lastUserMsg, currentPreferences);
  }
}

/** Group identical valid tickets and partition into upcoming, past, and other. */
export function groupTickets(tickets: MyTicket[], now: Date = new Date()): UserTicketsPayload {
  const validTickets = tickets.filter((t) => t.status === "valid");
  const otherTickets = tickets.filter((t) => t.status !== "valid");

  function groupList(list: MyTicket[]): GroupedTicketItem[] {
    const map = new Map<string, GroupedTicketItem>();

    for (const t of list) {
      const key = `${t.event.id}:${t.tier.id}:${t.status}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += 1;
        existing.totalPriceCents += t.unit_price_cents;
        existing.ticketNumbers.push(t.ticket_number);
      } else {
        map.set(key, {
          eventId: t.event.id,
          eventTitle: t.event.title,
          venue: t.event.venue,
          city: t.event.city,
          timezone: t.event.timezone,
          startsAt: t.event.starts_at,
          endsAt: t.event.ends_at,
          tierId: t.tier.id,
          tierName: t.tier.name,
          quantity: 1,
          totalPriceCents: t.unit_price_cents,
          status: t.status,
          ticketNumbers: [t.ticket_number],
        });
      }
    }
    return Array.from(map.values());
  }

  const groupedValid = groupList(validTickets);
  const nowMs = now.getTime();

  // Upcoming: ends_at >= now (including starts_at <= now < ends_at as "Happening now")
  const upcomingRaw = groupedValid.filter((g) => new Date(g.endsAt).getTime() >= nowMs);
  const pastRaw = groupedValid.filter((g) => new Date(g.endsAt).getTime() < nowMs);

  const upcoming = upcomingRaw.map((item) => ({
    ...item,
    howSoon: formatHowSoon(item.startsAt, item.endsAt, now),
  }));

  upcoming.sort((a, b) => {
    const aNow = a.howSoon === "Happening now";
    const bNow = b.howSoon === "Happening now";
    if (aNow && !bNow) return -1;
    if (!aNow && bNow) return 1;
    return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  });

  pastRaw.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

  const other = groupList(otherTickets);
  other.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

  return {
    upcoming,
    past: pastRaw,
    other,
  };
}

/** Check for schedule overlaps in valid upcoming ticket items. */
export function detectScheduleOverlaps(items: GroupedTicketItem[]): UpcomingSchedulePayload {
  const events = items.map((item) => ({ ...item, overlapsWith: [] as string[] }));
  let hasOverlaps = false;

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (a.eventId === b.eventId) continue;

      const aStart = new Date(a.startsAt).getTime();
      const aEnd = new Date(a.endsAt).getTime();
      const bStart = new Date(b.startsAt).getTime();
      const bEnd = new Date(b.endsAt).getTime();

      // Overlap: aStart < bEnd && bStart < aEnd
      if (aStart < bEnd && bStart < aEnd) {
        hasOverlaps = true;
        if (!a.overlapsWith.includes(b.eventTitle)) a.overlapsWith.push(b.eventTitle);
        if (!b.overlapsWith.includes(a.eventTitle)) b.overlapsWith.push(a.eventTitle);
      }
    }
  }

  return {
    nextEvent: events[0] ?? undefined,
    events,
    hasOverlaps,
  };
}

/** Format standby requests with plain-language wording depending on status. */
export function formatStandbyStatus(requests: MyStandbyRequest[]): StandbyStatusItem[] {
  return requests.map((req) => {
    let statusDescription = "";
    let isHoldActive = false;

    switch (req.status) {
      case "authorized":
        statusDescription =
          "A hold is placed with no upfront charge. Your ticket will be issued automatically if a seat becomes available.";
        isHoldActive = true;
        break;
      case "matched":
      case "settled":
        statusDescription =
          "A released seat was matched to you! Your ticket was issued and charged at the actual tier price.";
        break;
      case "draft":
        statusDescription = "Draft request. Nothing has been held or charged.";
        break;
      case "cancelled":
        statusDescription = "Request cancelled. Nothing is being held or charged.";
        break;
      case "expired":
        statusDescription =
          "Expired at release cutoff (2 hours before event). Nothing was charged.";
        break;
      case "failed":
        statusDescription = "Authorization failed. Nothing is being held or charged.";
        break;
      default:
        statusDescription = "Nothing is being held or charged.";
    }

    const tiersSummary = req.tiers.map((t) => t.name).join(", ");

    return {
      id: req.id,
      eventId: req.event.id,
      eventTitle: req.event.title,
      venue: req.event.venue,
      timezone: req.event.timezone,
      startsAt: req.event.starts_at,
      tiersSummary: tiersSummary || "Any tier",
      quantity: req.quantity,
      status: req.status,
      statusDescription,
      authorizedCents: req.authorized_cents,
      isHoldActive,
    };
  });
}

/** Deterministic filtering and combination solving. */
export function findMatchingEvents(
  allEvents: EventWithTiers[],
  constraints: ExtractedConstraints,
  previousEventIds: string[] = [],
  excludedOwnedEventIds: string[] = [],
): {
  matchedEvents: EventWithTiers[];
  budgetSummary?: BudgetSummary;
  dateRelaxed: boolean;
  soldOutExcluded: boolean;
  ownedExcludedCount: number;
  notes: string[];
} {
  const notes: string[] = [];

  // Filter 1: Base eligibility (exclude previously seen events if user asked for "different")
  let candidates = allEvents.filter((ev) => {
    if (constraints.followUpIntent === "different" && previousEventIds.includes(ev.id)) {
      return false;
    }
    return true;
  });

  // Filter 1b: Exclude events the user already holds a ticket for
  let ownedExcludedCount = 0;
  if (excludedOwnedEventIds.length > 0) {
    const beforeCount = candidates.length;
    candidates = candidates.filter((ev) => !excludedOwnedEventIds.includes(ev.id));
    ownedExcludedCount = beforeCount - candidates.length;
  }

  // Filter 2: Free only
  if (constraints.freeOnly) {
    candidates = candidates.filter((ev) => {
      const lowest = getLowestTier(ev);
      return lowest !== null && lowest.price_cents === 0;
    });
  }

  // Filter 3: Category match
  if (constraints.category) {
    const catLower = constraints.category.toLowerCase();
    const catFiltered = candidates.filter((ev) => ev.category.toLowerCase().includes(catLower));
    if (catFiltered.length > 0) {
      candidates = catFiltered;
    }
  }

  // Filter 4: Per-ticket budget
  if (constraints.perTicketBudgetCents) {
    const perTicketLimit = constraints.perTicketBudgetCents;
    candidates = candidates.filter((ev) => {
      const lowest = getLowestTier(ev);
      return lowest !== null && lowest.price_cents <= perTicketLimit;
    });
  }

  // Check for sold-out events
  let soldOutExcluded = false;
  const nonSoldOut = candidates.filter((ev) => !isEventSoldOut(ev));
  if (nonSoldOut.length >= (constraints.count ?? 1)) {
    candidates = nonSoldOut;
  } else if (nonSoldOut.length < candidates.length) {
    soldOutExcluded = true;
  }

  // Filter 5: Date matching
  let dateRelaxed = false;
  const dateFiltered = candidates.filter((ev) =>
    matchesDateConstraint(ev.starts_at, ev.timezone, constraints.dateType, constraints.targetDayOfWeek),
  );

  const desiredCount = constraints.count ?? (constraints.totalBudgetCents ? 2 : 3);

  if (dateFiltered.length < desiredCount && constraints.dateType && constraints.dateType !== "any") {
    dateRelaxed = true;
    notes.push(
      `We didn't find ${desiredCount} matching events strictly on ${
        constraints.dateType === "weekend" ? "this weekend" : "the requested date"
      }, so we included the closest upcoming events.`,
    );
  } else {
    candidates = dateFiltered;
  }

  // Score candidate events by topic relevance
  const scored = candidates
    .map((ev) => ({
      event: ev,
      score: calculateRelevanceScore(ev, constraints.topics),
      lowestTier: getLowestTier(ev),
    }))
    .filter((item) => item.lowestTier !== null);

  // Sort by relevance score descending, then lowest price ascending
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.lowestTier!.price_cents - b.lowestTier!.price_cents;
  });

  // Deterministic Budget Combination Finder
  let targetBudgetCents = constraints.totalBudgetCents ?? null;

  if (constraints.followUpIntent === "cheaper" && targetBudgetCents) {
    targetBudgetCents = Math.round(targetBudgetCents * 0.75);
    notes.push(`Adjusted target budget to under ${formatMoney(targetBudgetCents)}.`);
  }

  let selectedEvents: EventWithTiers[] = [];
  let budgetSummary: BudgetSummary | undefined = undefined;

  if (targetBudgetCents !== null && desiredCount > 1) {
    const n = scored.length;
    let bestCombo: typeof scored | null = null;
    let bestScore = -1;

    function testCombinations(start: number, currentCombo: typeof scored, currentSum: number) {
      if (currentCombo.length === desiredCount) {
        if (currentSum <= targetBudgetCents!) {
          const comboScore = currentCombo.reduce((acc, cur) => acc + cur.score, 0);
          if (comboScore > bestScore) {
            bestScore = comboScore;
            bestCombo = [...currentCombo];
          }
        }
        return;
      }
      for (let i = start; i < n; i++) {
        const item = scored[i];
        const nextSum = currentSum + item.lowestTier!.price_cents;
        if (nextSum <= targetBudgetCents!) {
          currentCombo.push(item);
          testCombinations(i + 1, currentCombo, nextSum);
          currentCombo.pop();
        }
      }
    }

    testCombinations(0, [], 0);

    if (bestCombo) {
      selectedEvents = (bestCombo as typeof scored).map((c) => c.event);
      const totalSpent = (bestCombo as typeof scored).reduce(
        (acc, c) => acc + c.lowestTier!.price_cents,
        0,
      );
      const breakdownItems = (bestCombo as typeof scored)
        .map((c) => formatMoney(c.lowestTier!.price_cents))
        .join(" + ");
      budgetSummary = {
        breakdown: `${breakdownItems} = ${formatMoney(totalSpent)} of your ${formatMoney(targetBudgetCents)}`,
        totalSpentCents: totalSpent,
        budgetCents: targetBudgetCents,
      };
    } else {
      notes.push(
        `We couldn't find ${desiredCount} events with a combined price under ${formatMoney(targetBudgetCents)}.`,
      );
    }
  } else {
    const eligible = scored.filter((s) => {
      if (targetBudgetCents && s.lowestTier!.price_cents > targetBudgetCents) return false;
      return true;
    });

    selectedEvents = eligible.slice(0, desiredCount).map((s) => s.event);

    if (targetBudgetCents && selectedEvents.length > 0) {
      const totalSpent = selectedEvents.reduce(
        (acc, ev) => acc + (getLowestTier(ev)?.price_cents ?? 0),
        0,
      );
      const breakdownItems = selectedEvents
        .map((ev) => formatMoney(getLowestTier(ev)?.price_cents ?? 0))
        .join(" + ");
      budgetSummary = {
        breakdown: `${breakdownItems} = ${formatMoney(totalSpent)} of your ${formatMoney(targetBudgetCents)}`,
        totalSpentCents: totalSpent,
        budgetCents: targetBudgetCents,
      };
    }
  }

  return {
    matchedEvents: selectedEvents,
    budgetSummary,
    dateRelaxed,
    soldOutExcluded,
    ownedExcludedCount,
    notes,
  };
}

/** Execute planner pipeline: intent classification -> deterministic handlers -> explanation. */
export async function planEvents(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  allEvents: EventWithTiers[],
  currentPreferences: SessionPreferences = {},
  profile?: Profile | null,
): Promise<PlanApiResponse> {
  const constraints = await extractConstraints(messages, currentPreferences);
  const intent = constraints.intent ?? "discover";

  // Handle Intent 1: my_tickets
  if (intent === "my_tickets") {
    if (!profile) {
      const authReply: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "Please choose a demo person first (using the menu at the top right) to view your tickets.",
        intent: "my_tickets",
        requiresAuth: true,
        createdAt: new Date().toISOString(),
      };
      return { message: authReply, preferences: currentPreferences };
    }

    const tickets = await listMyTickets(profile);
    const grouped = groupTickets(tickets, new Date());

    let content = "";
    if (tickets.length === 0) {
      content = "You don't have any tickets yet. Would you like me to recommend some upcoming events?";
    } else {
      const totalValidCount = [...grouped.upcoming, ...grouped.past].reduce(
        (acc, g) => acc + g.quantity,
        0,
      );
      content = `Here are the tickets for **${profile.name}** (${totalValidCount} valid ticket${
        totalValidCount === 1 ? "" : "s"
      }):`;

      if (grouped.upcoming.length > 0) {
        content += "\n\n**Upcoming:**";
        for (const u of grouped.upcoming) {
          content += `\n• **${u.eventTitle}** (${formatEventDay(u.startsAt, u.timezone)} · ${formatEventTimeRange(
            u.startsAt,
            u.endsAt,
            u.timezone,
          )}) — ${u.quantity} × ${u.tierName} (${formatMoney(u.totalPriceCents)})`;
        }
      }

      if (grouped.past.length > 0) {
        content += "\n\n**Past:**";
        for (const p of grouped.past) {
          content += `\n• **${p.eventTitle}** (${formatEventDay(p.startsAt, p.timezone)}) — ${p.quantity} × ${
            p.tierName
          } (${formatMoney(p.totalPriceCents)})`;
        }
      }

      if (grouped.other.length > 0) {
        content += "\n\n**Released / Transferred:**";
        for (const o of grouped.other) {
          content += `\n• **${o.eventTitle}** (${o.status === "released" ? "Released, still yours until resold" : "Transferred / resold"}) — ${o.quantity} × ${o.tierName}`;
        }
      }

      content += "\n\nYou can view and manage all your tickets in [My tickets](/tickets).";
    }

    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      intent: "my_tickets",
      userTickets: grouped,
      createdAt: new Date().toISOString(),
    };
    return { message: reply, preferences: currentPreferences };
  }

  // Handle Intent 2: upcoming schedule & overlap detection
  if (intent === "upcoming") {
    if (!profile) {
      const authReply: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "Please choose a demo person first (using the menu at the top right) to view your upcoming events.",
        intent: "upcoming",
        requiresAuth: true,
        createdAt: new Date().toISOString(),
      };
      return { message: authReply, preferences: currentPreferences };
    }

    const tickets = await listMyTickets(profile);
    const grouped = groupTickets(tickets, new Date());
    const schedule = detectScheduleOverlaps(grouped.upcoming);

    let content = "";
    if (schedule.events.length === 0) {
      content = "You don't have any upcoming ticketed events right now. Would you like me to find some upcoming events for you?";
    } else {
      const next = schedule.nextEvent!;
      content = `Your next event is **"${next.eventTitle}"** (${next.howSoon}) at ${next.venue}.\nWhen: ${formatEventDay(
        next.startsAt,
        next.timezone,
      )} · ${formatEventTimeRange(next.startsAt, next.endsAt, next.timezone)}.`;

      if (schedule.events.length > 1) {
        content += `\n\nYou have ${schedule.events.length} upcoming ticketed events scheduled in total.`;
      }

      if (schedule.hasOverlaps) {
        content += "\n\n⚠️ **Schedule overlap alert:**";
        for (const ev of schedule.events) {
          if (ev.overlapsWith && ev.overlapsWith.length > 0) {
            content += `\n• **${ev.eventTitle}** overlaps in time with **${ev.overlapsWith.join(", ")}**.`;
          }
        }
      }

      content += "\n\nYou can view all details in [My tickets](/tickets).";
    }

    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      intent: "upcoming",
      upcomingSchedule: schedule,
      createdAt: new Date().toISOString(),
    };
    return { message: reply, preferences: currentPreferences };
  }

  // Handle Intent 3: standby_status
  if (intent === "standby_status") {
    if (!profile) {
      const authReply: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          "Please choose a demo person first (using the menu at the top right) to check your standby status.",
        intent: "standby_status",
        requiresAuth: true,
        createdAt: new Date().toISOString(),
      };
      return { message: authReply, preferences: currentPreferences };
    }

    const requests = await listMyStandbyRequests(profile);
    const summaryItems = formatStandbyStatus(requests);

    let content = "";
    if (summaryItems.length === 0) {
      content = "You don't have any standby requests right now. If an event sells out, you can join standby with a PayPal hold and no upfront charge.";
    } else {
      const activeCount = summaryItems.filter((s) => s.isHoldActive).length;
      content = `Here is the standby status for **${profile.name}** (${activeCount} active hold${
        activeCount === 1 ? "" : "s"
      }):`;

      for (const item of summaryItems) {
        content += `\n\n• **${item.eventTitle}** (${item.quantity} seat${item.quantity === 1 ? "" : "s"} · ${
          item.tiersSummary
        })\n  Max hold: ${formatMoney(item.authorizedCents)} (authorized, not charged)\n  Status: ${
          item.statusDescription
        }`;
      }

      content += "\n\nYou can view and cancel holds anytime in [Standby](/standby).";
    }

    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      intent: "standby_status",
      standbySummary: summaryItems,
      createdAt: new Date().toISOString(),
    };
    return { message: reply, preferences: currentPreferences };
  }

  // Handle Intent 4: other / general
  if (intent === "other") {
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Hi! I can help you discover upcoming events in San Francisco, review your purchased tickets, check what's on your schedule next, or see your standby status. What would you like to do?",
      intent: "other",
      createdAt: new Date().toISOString(),
    };
    return { message: reply, preferences: currentPreferences };
  }

  // Handle Intent 5: discover (Default event search & recommendation)
  if (constraints.needsClarification && constraints.clarifyingQuestion) {
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: constraints.clarifyingQuestion,
      clarification: true,
      intent: "discover",
      createdAt: new Date().toISOString(),
    };
    return { message: reply, preferences: currentPreferences };
  }

  const previousEventIds: string[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && (m as ChatMessage).events) {
      for (const ev of (m as ChatMessage).events!) {
        previousEventIds.push(ev.id);
      }
    }
  }

  // Find owned events to exclude from discover recommendations
  const excludedOwnedEventIds: string[] = [];
  if (profile) {
    try {
      const ownedTickets = await listMyTickets(profile);
      for (const t of ownedTickets) {
        if (t.status === "valid" && !excludedOwnedEventIds.includes(t.event.id)) {
          excludedOwnedEventIds.push(t.event.id);
        }
      }
    } catch (e) {
      console.error("Could not load owned tickets for exclusion:", e);
    }
  }

  const {
    matchedEvents,
    budgetSummary,
    dateRelaxed,
    soldOutExcluded,
    ownedExcludedCount,
  } = findMatchingEvents(allEvents, constraints, previousEventIds, excludedOwnedEventIds);

  const realEventMap = new Map(allEvents.map((e) => [e.id, e]));
  const validatedEvents = matchedEvents
    .map((e) => realEventMap.get(e.id))
    .filter((e): e is EventWithTiers => e !== undefined);

  const updatedPreferences: SessionPreferences = {
    ...currentPreferences,
    topics: constraints.topics?.length ? constraints.topics : currentPreferences.topics,
    category: constraints.category ?? currentPreferences.category,
    totalBudgetCents: constraints.totalBudgetCents ?? currentPreferences.totalBudgetCents,
    perTicketBudgetCents: constraints.perTicketBudgetCents ?? currentPreferences.perTicketBudgetCents,
    count: constraints.count ?? currentPreferences.count,
    freeOnly: constraints.freeOnly || currentPreferences.freeOnly,
    dateRange: constraints.dateType
      ? { label: constraints.dateType }
      : currentPreferences.dateRange,
  };

  let explanation = "";
  let actionProposal: ActionProposal | undefined = undefined;

  if (validatedEvents.length === 0) {
    const freeEvents = allEvents.filter((e) => {
      const t = getLowestTier(e);
      return t && t.price_cents === 0 && !excludedOwnedEventIds.includes(e.id);
    });

    explanation = `We couldn't find any events matching your exact criteria (${[
      constraints.category ? `category: ${constraints.category}` : null,
      constraints.topics?.length ? `topics: ${constraints.topics.join(", ")}` : null,
      constraints.totalBudgetCents ? `budget: ${formatMoney(constraints.totalBudgetCents)}` : null,
      constraints.dateType && constraints.dateType !== "any" ? `date: ${constraints.dateType}` : null,
    ]
      .filter(Boolean)
      .join(", ")}).`;

    if (freeEvents.length > 0) {
      explanation += `\n\nWould you like to check out some popular free events like "${freeEvents[0].title}" instead, or try relaxing your budget or dates?`;
    } else {
      explanation += `\n\nTry adjusting your budget or searching for broader categories like "AI" or "Workshop".`;
    }
  } else {
    const eventNames = validatedEvents.map((e) => `"${e.title}"`).join(" and ");
    const countWord = validatedEvents.length === 1 ? "event" : "events";

    let prefix = `Here ${validatedEvents.length === 1 ? "is the" : "are"} ${validatedEvents.length} ${countWord} matching your preferences:`;

    if (constraints.assumptions) {
      prefix = `${constraints.assumptions} ${prefix}`;
    }

    if (dateRelaxed) {
      prefix = `We found ${validatedEvents.length} great ${countWord} coming up (${eventNames}) that fit your request:`;
    }

    explanation = prefix;

    if (budgetSummary) {
      explanation += `\n\n**Budget Summary:** ${budgetSummary.breakdown}.`;
    }

    if (soldOutExcluded) {
      explanation += `\n\n*(Note: Some sold-out events were excluded from this recommendation).*`;
    }

    if (ownedExcludedCount > 0) {
      explanation += `\n\n*(Note: Events you already hold a ticket for were excluded from recommendations).*`;
    }

    const primaryEvent = validatedEvents[0];
    const availableTiers = primaryEvent.ticket_tiers.filter((t) => t.sold_count < t.capacity);
    const soldOutTiers = primaryEvent.ticket_tiers.filter((t) => t.sold_count >= t.capacity);

    if (availableTiers.length === 0) {
      explanation += `\n\n**"${primaryEvent.title}" is currently full.**\nDo you want me to join the standby list so you get a ticket as soon as one becomes available? (A hold is placed with no upfront charge, and your ticket is issued automatically if a seat becomes available).`;
      actionProposal = {
        type: "standby",
        eventId: primaryEvent.id,
        selectedTierId: soldOutTiers[0]?.id ?? "",
        soldOutTiers,
        promptText:
          "Do you want me to join the standby list so you get a ticket as soon as one becomes available?",
        status: "pending",
      };
    } else {
      if (soldOutTiers.length > 0) {
        explanation += `\n\n*(Note: Some tiers like ${soldOutTiers.map((t) => `"${t.name}"`).join(", ")} are sold out, but standby is available if you prefer those).*`;
      }
      explanation += `\n\nShould I purchase a ticket?`;
      actionProposal = {
        type: "purchase",
        eventId: primaryEvent.id,
        selectedTierId: availableTiers[0].id,
        availableTiers,
        soldOutTiers: soldOutTiers.length > 0 ? soldOutTiers : undefined,
        promptText: "Should I purchase a ticket?",
        status: "pending",
      };
    }
  }

  const reply: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: explanation,
    intent: "discover",
    events: validatedEvents.length > 0 ? validatedEvents : undefined,
    budgetSummary: budgetSummary ?? undefined,
    actionProposal,
    createdAt: new Date().toISOString(),
  };

  return {
    message: reply,
    preferences: updatedPreferences,
  };
}
