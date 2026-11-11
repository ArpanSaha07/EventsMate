import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  findMatchingEvents,
  matchesDateConstraint,
  getLowestTier,
  planEvents,
} from "@/lib/discovery/planner";
import type { EventWithTiers } from "@/lib/types";

const mockEvents: EventWithTiers[] = [
  {
    id: "ev-1",
    title: "Hands-on RAG Workshop",
    description: "Build a retrieval pipeline step by step and learn where it breaks.",
    category: "Workshop",
    venue: "Mission Workshop Hall",
    city: "San Francisco",
    timezone: "America/Los_Angeles",
    starts_at: "2026-11-17T18:00:00-08:00", // Tuesday
    ends_at: "2026-11-17T21:00:00-08:00",
    refund_policy_text: "Standard refund",
    standby_count: 0,
    ticket_tiers: [
      {
        id: "t-1",
        name: "General Admission",
        description: "General seat",
        price_cents: 2000, // $20
        currency: "USD",
        capacity: 25,
        sold_count: 10,
        sort_order: 1,
      },
      {
        id: "t-2",
        name: "VIP",
        description: "VIP seat",
        price_cents: 3500, // $35
        currency: "USD",
        capacity: 5,
        sold_count: 0,
        sort_order: 2,
      },
    ],
  },
  {
    id: "ev-2",
    title: "Build Your First AI Agent",
    description: "Wire a tool-calling agent to a real API and leave with a small working assistant.",
    category: "Workshop",
    venue: "SoMa Makers Loft",
    city: "San Francisco",
    timezone: "America/Los_Angeles",
    starts_at: "2026-11-19T10:00:00-08:00", // Thursday
    ends_at: "2026-11-19T13:00:00-08:00",
    refund_policy_text: "Standard refund",
    standby_count: 0,
    ticket_tiers: [
      {
        id: "t-3",
        name: "General Admission",
        description: "General seat",
        price_cents: 1800, // $18
        currency: "USD",
        capacity: 30,
        sold_count: 5,
        sort_order: 1,
      },
    ],
  },
  {
    id: "ev-3",
    title: "SF AI Founders Mixer",
    description: "Short founder talks, then open networking for people building AI startups.",
    category: "Meetup",
    venue: "Hayes Valley Commons",
    city: "San Francisco",
    timezone: "America/Los_Angeles",
    starts_at: "2026-11-15T18:30:00-08:00", // Sunday (weekend)
    ends_at: "2026-11-15T21:00:00-08:00",
    refund_policy_text: "Standard refund",
    standby_count: 0,
    ticket_tiers: [
      {
        id: "t-4",
        name: "General",
        description: "Free meetup entry",
        price_cents: 0, // Free
        currency: "USD",
        capacity: 60,
        sold_count: 20,
        sort_order: 1,
      },
    ],
  },
  {
    id: "ev-4",
    title: "Design Sprint for AI Products",
    description: "A one-day sprint: frame a problem, prototype an AI feature, test it with users.",
    category: "Workshop",
    venue: "Dogpatch Studio",
    city: "San Francisco",
    timezone: "America/Los_Angeles",
    starts_at: "2026-11-21T09:30:00-08:00", // Saturday (weekend)
    ends_at: "2026-11-21T16:00:00-08:00",
    refund_policy_text: "Standard refund",
    standby_count: 0,
    ticket_tiers: [
      {
        id: "t-5",
        name: "Early Bird",
        description: "Discounted",
        price_cents: 2500, // $25
        currency: "USD",
        capacity: 10,
        sold_count: 2,
        sort_order: 1,
      },
      {
        id: "t-6",
        name: "Standard",
        description: "Full price",
        price_cents: 4000, // $40
        currency: "USD",
        capacity: 20,
        sold_count: 5,
        sort_order: 2,
      },
    ],
  },
];

describe("Planner Logic", () => {
  it("Scenario b: returns exactly two AI workshops whose combined price is <= $40", () => {
    const result = findMatchingEvents(mockEvents, {
      topics: ["AI", "workshop"],
      category: "Workshop",
      count: 2,
      totalBudgetCents: 4000, // $40
      dateType: "weekend",
    });

    expect(result.matchedEvents).toHaveLength(2);
    // Combined price must be <= $4000 (ev-1 is $20, ev-2 is $18 => $38)
    const totalSpent = result.matchedEvents.reduce(
      (sum, ev) => sum + (getLowestTier(ev)?.price_cents ?? 0),
      0,
    );
    expect(totalSpent).toBeLessThanOrEqual(4000);
    expect(totalSpent).toBe(3800);
    expect(result.budgetSummary?.breakdown).toContain("= $38.00 of your $40.00");
    expect(result.budgetSummary?.breakdown).toContain("$18.00");
    expect(result.budgetSummary?.breakdown).toContain("$20.00");
  });

  it("Scenario c: returns empty matches when no events match constraints (e.g. impossible budget or category)", () => {
    const result = findMatchingEvents(mockEvents, {
      category: "NonExistentCategory",
      topics: ["quantum teleportation"],
      totalBudgetCents: 100, // $1
      count: 2,
    });

    expect(result.matchedEvents).toHaveLength(0);
  });

  it("Scenario d: handles 'make it cheaper' follow-up correctly", () => {
    // Initial result with $40 budget
    const initial = findMatchingEvents(mockEvents, {
      category: "Workshop",
      count: 2,
      totalBudgetCents: 4000,
    });
    expect(initial.matchedEvents).toHaveLength(2);

    // Follow-up: make it cheaper (e.g. lowers target budget or seeks lower priced/free events)
    const cheaper = findMatchingEvents(mockEvents, {
      category: "Workshop",
      count: 2,
      totalBudgetCents: 4000,
      followUpIntent: "cheaper",
    });

    // Target budget becomes 75% of $40 = $30. 2 workshops ($20 + $18 = $38) exceed $30!
    // So it correctly finds 0 combinations that exceed $30, or finds cheaper options.
    expect(cheaper.notes.some((n) => n.includes("Adjusted target budget"))).toBe(true);
  });

  it("Scenario e: never returns an event that is not in the data", () => {
    const result = findMatchingEvents(mockEvents, {
      topics: ["AI"],
      freeOnly: true,
    });

    expect(result.matchedEvents).toHaveLength(1);
    expect(result.matchedEvents[0].id).toBe("ev-3");
    // Verify every matched event is an exact object from mockEvents
    for (const ev of result.matchedEvents) {
      expect(mockEvents.some((m) => m.id === ev.id)).toBe(true);
    }
  });

  it("evaluates date constraints properly in America/Los_Angeles", () => {
    // Sunday 2026-11-15 is weekend
    expect(matchesDateConstraint("2026-11-15T18:30:00-08:00", "America/Los_Angeles", "weekend")).toBe(true);
    // Tuesday 2026-11-17 is not weekend
    expect(matchesDateConstraint("2026-11-17T18:00:00-08:00", "America/Los_Angeles", "weekend")).toBe(false);
    // Saturday 2026-11-21 matches targetDayOfWeek=6
    expect(matchesDateConstraint("2026-11-21T09:30:00-08:00", "America/Los_Angeles", "weekend", 6)).toBe(true);
  });

  it("Requirement 1: attaches purchase action proposal with 'Should I purchase a ticket?' when seats are available", async () => {
    const res = await planEvents(
      [{ role: "user", content: "Show me the RAG workshop" }],
      mockEvents,
      {},
    );

    expect(res.message.events).toBeDefined();
    expect(res.message.events!.length).toBeGreaterThan(0);
    expect(res.message.actionProposal).toBeDefined();
    expect(res.message.actionProposal?.type).toBe("purchase");
    expect(res.message.actionProposal?.promptText).toBe("Should I purchase a ticket?");
    expect(res.message.actionProposal?.status).toBe("pending");
    expect(res.message.content).toContain("Should I purchase a ticket?");
  });

  it("Requirement 2: attaches standby action proposal and explains full capacity when event is sold out", async () => {
    // Event where all tiers are sold out
    const soldOutEvent: EventWithTiers = {
      ...mockEvents[0],
      id: "ev-sold-out",
      title: "Completely Sold Out AI Summit",
      ticket_tiers: [
        {
          id: "t-so-1",
          name: "General",
          description: "Sold out",
          price_cents: 5000,
          currency: "USD",
          capacity: 10,
          sold_count: 10, // Full
          sort_order: 1,
        },
      ],
    };

    const res = await planEvents(
      [{ role: "user", content: "Show me the AI summit" }],
      [soldOutEvent],
      {},
    );

    expect(res.message.events).toBeDefined();
    expect(res.message.actionProposal).toBeDefined();
    expect(res.message.actionProposal?.type).toBe("standby");
    expect(res.message.actionProposal?.promptText).toContain("join the standby list");
    expect(res.message.content).toContain("is currently full");
    expect(res.message.content).toContain("no upfront charge");
  });
});
