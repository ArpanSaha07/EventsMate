import "server-only";
import { formatMoney } from "@/lib/money";
import type { EventWithTiers, Tier } from "@/lib/types";
import { getOpenAIClient, getOpenAIModel } from "@/lib/discovery/openai";
import type {
  ActionProposal,
  BudgetSummary,
  ChatMessage,
  PlanApiResponse,
  SessionPreferences,
} from "@/lib/discovery/types";

export type ExtractedConstraints = {
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
    // Check if event is the following day
    const diffDays = Math.round((new Date(evYear, evMonth - 1, evDay).getTime() - new Date(nowTz.year, nowTz.month - 1, nowTz.day).getTime()) / (1000 * 60 * 60 * 24));
    return diffDays === 1;
  }

  if (dateType === "weekend") {
    // Saturday or Sunday
    return evDayOfWeek === 0 || evDayOfWeek === 6;
  }

  if (dateType === "friday_evening") {
    return evDayOfWeek === 5 && evHour >= 17;
  }

  if (dateType === "this_week") {
    const diffDays = Math.round((new Date(evYear, evMonth - 1, evDay).getTime() - new Date(nowTz.year, nowTz.month - 1, nowTz.day).getTime()) / (1000 * 60 * 60 * 24));
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
  const searchable = `${event.title} ${event.description} ${event.category} ${event.venue} ${event.ticket_tiers.map((t) => `${t.name} ${t.description}`).join(" ")}`.toLowerCase();

  for (const topic of topics) {
    const t = topic.toLowerCase().trim();
    if (!t) continue;
    if (searchable.includes(t)) {
      score += 5;
    }
    // Partial word match
    const words = t.split(/\s+/);
    for (const w of words) {
      if (w.length >= 3 && searchable.includes(w)) {
        score += 2;
      }
    }
  }
  return score;
}

/** Extract structured constraints using OpenAI function calling or JSON mode. */
export async function extractConstraints(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  currentPreferences: SessionPreferences = {},
): Promise<ExtractedConstraints> {
  const nowTz = getNowInTimezone("America/Los_Angeles");

  const systemPrompt = `You are the event discovery assistant for EventsMate.
Current Date in San Francisco (America/Los_Angeles): ${nowTz.dateStr} (Day of week: ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][nowTz.dayOfWeek]}).

Your job is to parse the user's latest query and conversation history into structured event search constraints.
Categories in this app include: "Workshop", "Meetup", "Hackathon".
Events are located in San Francisco and priced in USD.

Return a JSON object conforming to this schema:
{
  "topics": string[],                // e.g. ["AI", "workshop", "beginner", "coding", "agents"]
  "category": string | null,         // e.g. "Workshop", "Meetup", "Hackathon"
  "dateType": "weekend" | "today" | "tomorrow" | "friday_evening" | "this_week" | "any",
  "targetDayOfWeek": number | null,  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat if a specific day is requested (e.g. "only Saturday" -> 6)
  "totalBudgetCents": number | null, // in integer cents, e.g. $40 -> 4000, $15 -> 1500
  "perTicketBudgetCents": number | null,
  "count": number | null,            // number of events requested, e.g. "two workshops" -> 2
  "freeOnly": boolean,               // true if user asked for "free" events
  "followUpIntent": "cheaper" | "different" | "filter_date" | "filter_category" | null,
  "needsClarification": boolean,     // true ONLY if the request is completely incomprehensible or vague with no intent discernible
  "clarifyingQuestion": string | null,
  "assumptions": string | null       // brief note of sensible assumptions made (e.g. "Assuming you want 2 upcoming AI workshops.")
}

Important Rules:
- If the user says "Find me two AI workshops this weekend, with a total ticket budget of $40":
  topics=["AI", "workshop"], category="Workshop", count=2, totalBudgetCents=4000, dateType="weekend".
- If the user says "make it cheaper", followUpIntent="cheaper".
- If the user says "only Saturday", targetDayOfWeek=6, followUpIntent="filter_date".
- If the user says "show me something else", followUpIntent="different".
- If the user says "Something free on Friday evening", freeOnly=true, dateType="friday_evening".
- If the user says "Beginner-friendly coding events under $15 each", topics=["beginner", "coding"], perTicketBudgetCents=1500.
- If no date or budget is given, do NOT ask for clarification unless the query is completely empty. Proceed with sensible defaults (upcoming dates, any budget) and state the assumption.`;

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

    return {
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
    // Deterministic fallback if LLM extraction fails
    const lastUserMsg = messages.filter((m) => m.role === "user").slice(-1)[0]?.content || "";
    return fallbackExtract(lastUserMsg, currentPreferences);
  }
}

/** Fallback regex/keyword extraction if LLM call is unavailable. */
function fallbackExtract(text: string, prefs: SessionPreferences): ExtractedConstraints {
  const lower = text.toLowerCase();
  const countMatch = lower.match(/\b(two|2)\b/);
  const count = countMatch ? 2 : lower.match(/\b(three|3)\b/) ? 3 : lower.match(/\b(one|1)\b/) ? 1 : prefs.count ?? null;
  const budgetMatch = lower.match(/\$(\d+)/);
  const totalBudgetCents = budgetMatch ? parseInt(budgetMatch[1], 10) * 100 : prefs.totalBudgetCents ?? null;
  const freeOnly = lower.includes("free");
  const isWeekend = lower.includes("weekend");
  const isSaturday = lower.includes("saturday");

  return {
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

/** Deterministic filtering and combination solving. */
export function findMatchingEvents(
  allEvents: EventWithTiers[],
  constraints: ExtractedConstraints,
  previousEventIds: string[] = [],
): {
  matchedEvents: EventWithTiers[];
  budgetSummary?: BudgetSummary;
  dateRelaxed: boolean;
  soldOutExcluded: boolean;
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

  // If strict date filter doesn't yield enough events, relax date constraint to closest upcoming events
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

  // If follow-up is "cheaper", reduce budget
  if (constraints.followUpIntent === "cheaper" && targetBudgetCents) {
    targetBudgetCents = Math.round(targetBudgetCents * 0.75);
    notes.push(`Adjusted target budget to under ${formatMoney(targetBudgetCents)}.`);
  }

  let selectedEvents: EventWithTiers[] = [];
  let budgetSummary: BudgetSummary | undefined = undefined;

  if (targetBudgetCents !== null && desiredCount > 1) {
    // Find combination of length `desiredCount` where sum(lowestTier.price_cents) <= targetBudgetCents
    const n = scored.length;
    let bestCombo: typeof scored | null = null;
    let bestScore = -1;

    // Helper to generate combinations of length k
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
      // No combination fit within budget!
      notes.push(
        `We couldn't find ${desiredCount} events with a combined price under ${formatMoney(targetBudgetCents)}.`,
      );
    }
  } else {
    // Single event or no total budget constraint
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
    notes,
  };
}

/** Execute planner pipeline: extraction -> deterministic matching & math -> explanation. */
export async function planEvents(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  allEvents: EventWithTiers[],
  currentPreferences: SessionPreferences = {},
): Promise<PlanApiResponse> {
  // 1. Extract constraints
  const constraints = await extractConstraints(messages, currentPreferences);

  // If user query is a clarifying question response or ambiguous
  if (constraints.needsClarification && constraints.clarifyingQuestion) {
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: constraints.clarifyingQuestion,
      clarification: true,
      createdAt: new Date().toISOString(),
    };
    return { message: reply, preferences: currentPreferences };
  }

  // 2. Deterministic filtering and arithmetic
  // Collect event IDs shown in previous assistant messages for "show me something else"
  const previousEventIds: string[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && (m as ChatMessage).events) {
      for (const ev of (m as ChatMessage).events!) {
        previousEventIds.push(ev.id);
      }
    }
  }

  const { matchedEvents, budgetSummary, dateRelaxed, soldOutExcluded } = findMatchingEvents(
    allEvents,
    constraints,
    previousEventIds,
  );

  // 3. Validation: Verify EVERY event ID exists in the real database events
  const realEventMap = new Map(allEvents.map((e) => [e.id, e]));
  const validatedEvents = matchedEvents
    .map((e) => realEventMap.get(e.id))
    .filter((e): e is EventWithTiers => e !== undefined);

  // 4. Update session preferences
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

  // 5. Generate friendly explanation
  let explanation = "";
  let actionProposal: ActionProposal | undefined = undefined;

  if (validatedEvents.length === 0) {
    // Honest "nothing found" answer with suggested alternatives
    const freeEvents = allEvents.filter((e) => {
      const t = getLowestTier(e);
      return t && t.price_cents === 0;
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
      explanation += `\n\nWould you like to check out some of our popular free events like "${freeEvents[0].title}" instead, or try relaxing your budget or dates?`;
    } else {
      explanation += `\n\nTry adjusting your budget or searching for broader categories like "AI" or "Workshop".`;
    }
  } else {
    // Success response
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

    // Determine purchase or standby action in code
    const primaryEvent = validatedEvents[0];
    const availableTiers = primaryEvent.ticket_tiers.filter((t) => t.sold_count < t.capacity);
    const soldOutTiers = primaryEvent.ticket_tiers.filter((t) => t.sold_count >= t.capacity);

    if (availableTiers.length === 0) {
      // Event is full
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
      // Seats available
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
