import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  findMatchingEvents,
  matchesDateConstraint,
  getLowestTier,
  planEvents,
  fallbackClassifyIntent,
  groupTickets,
  detectScheduleOverlaps,
  formatStandbyStatus,
} from "@/lib/discovery/planner";
import type { EventWithTiers, MyStandbyRequest, MyTicket } from "@/lib/types";

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
    refund_rule: null,
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
    refund_rule: null,
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
    refund_rule: null,
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
    refund_rule: null,
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

  describe("Intent Classification Fallback", () => {
    it("classifies user ticket queries into my_tickets", () => {
      expect(fallbackClassifyIntent("what tickets do I have")).toBe("my_tickets");
      expect(fallbackClassifyIntent("show my tickets")).toBe("my_tickets");
      expect(fallbackClassifyIntent("did my payment go through")).toBe("my_tickets");
      expect(fallbackClassifyIntent("what did i buy")).toBe("my_tickets");
    });

    it("classifies personal schedule queries into upcoming", () => {
      expect(fallbackClassifyIntent("which event is next")).toBe("upcoming");
      expect(fallbackClassifyIntent("what's coming up for me")).toBe("upcoming");
      expect(fallbackClassifyIntent("what event should i attend next")).toBe("upcoming");
      expect(fallbackClassifyIntent("what do i have this week")).toBe("upcoming");
    });

    it("classifies standby status queries into standby_status", () => {
      expect(fallbackClassifyIntent("what's happening with my standby")).toBe("standby_status");
      expect(fallbackClassifyIntent("check my standby status")).toBe("standby_status");
      expect(fallbackClassifyIntent("am I on standby")).toBe("standby_status");
    });

    it("never routes discovery or search requests to data handlers", () => {
      expect(fallbackClassifyIntent("Find me two AI workshops this weekend")).toBe("discover");
      expect(fallbackClassifyIntent("free events this week")).toBe("discover");
      expect(fallbackClassifyIntent("AI workshops under $40")).toBe("discover");
      expect(fallbackClassifyIntent("only saturday")).toBe("discover");
      expect(fallbackClassifyIntent("make it cheaper")).toBe("discover");
    });
  });

  describe("groupTickets & Partitioning", () => {
    const fixedNow = new Date("2026-11-17T12:00:00-08:00");

    const sampleTickets: MyTicket[] = [
      {
        id: "t-valid-1",
        ticket_number: "TICK-001",
        status: "valid",
        unit_price_cents: 2000,
        created_at: "2026-11-10T00:00:00Z",
        released_at: null,
        returned_at: null,
        release_blocked: null,
        refund: null,
        release_cutoff_at: "2026-11-17T16:00:00-08:00",
        tier: { id: "tier-1", name: "General Admission" },
        event: {
          id: "ev-upcoming-1",
          title: "Upcoming Event 1",
          venue: "Hall A",
          city: "San Francisco",
          timezone: "America/Los_Angeles",
          starts_at: "2026-11-18T18:00:00-08:00",
          ends_at: "2026-11-18T21:00:00-08:00",
        },
      },
      {
        id: "t-valid-2",
        ticket_number: "TICK-002",
        status: "valid",
        unit_price_cents: 2000,
        created_at: "2026-11-10T00:00:00Z",
        released_at: null,
        returned_at: null,
        release_blocked: null,
        refund: null,
        release_cutoff_at: "2026-11-17T16:00:00-08:00",
        tier: { id: "tier-1", name: "General Admission" },
        event: {
          id: "ev-upcoming-1",
          title: "Upcoming Event 1",
          venue: "Hall A",
          city: "San Francisco",
          timezone: "America/Los_Angeles",
          starts_at: "2026-11-18T18:00:00-08:00",
          ends_at: "2026-11-18T21:00:00-08:00",
        },
      },
      {
        id: "t-happening-now",
        ticket_number: "TICK-003",
        status: "valid",
        unit_price_cents: 3000,
        created_at: "2026-11-10T00:00:00Z",
        released_at: null,
        returned_at: null,
        release_blocked: null,
        refund: null,
        release_cutoff_at: "2026-11-17T08:00:00-08:00",
        tier: { id: "tier-now", name: "VIP" },
        event: {
          id: "ev-now",
          title: "Live Ongoing Meetup",
          venue: "Hall B",
          city: "San Francisco",
          timezone: "America/Los_Angeles",
          starts_at: "2026-11-17T10:00:00-08:00", // Started at 10 AM, now is 12 PM
          ends_at: "2026-11-17T14:00:00-08:00", // Ends at 2 PM
        },
      },
      {
        id: "t-past",
        ticket_number: "TICK-004",
        status: "valid",
        unit_price_cents: 1500,
        created_at: "2026-11-01T00:00:00Z",
        released_at: null,
        returned_at: null,
        release_blocked: null,
        refund: null,
        release_cutoff_at: "2026-11-10T16:00:00-08:00",
        tier: { id: "tier-past", name: "Early Bird" },
        event: {
          id: "ev-past",
          title: "Past Hackathon",
          venue: "Hall C",
          city: "San Francisco",
          timezone: "America/Los_Angeles",
          starts_at: "2026-11-10T09:00:00-08:00",
          ends_at: "2026-11-10T18:00:00-08:00",
        },
      },
      {
        id: "t-released",
        ticket_number: "TICK-005",
        status: "released",
        unit_price_cents: 2500,
        created_at: "2026-11-01T00:00:00Z",
        released_at: "2026-11-11T00:00:00Z",
        returned_at: null,
        release_blocked: null,
        refund: null,
        release_cutoff_at: "2026-11-19T16:00:00-08:00",
        tier: { id: "tier-rel", name: "General" },
        event: {
          id: "ev-rel",
          title: "Released Ticket Event",
          venue: "Hall D",
          city: "San Francisco",
          timezone: "America/Los_Angeles",
          starts_at: "2026-11-20T18:00:00-08:00",
          ends_at: "2026-11-20T21:00:00-08:00",
        },
      },
    ];

    it("groups identical tickets into one row with total price and quantity", () => {
      const grouped = groupTickets(sampleTickets, fixedNow);
      const evUpcoming = grouped.upcoming.find((u) => u.eventId === "ev-upcoming-1");
      expect(evUpcoming).toBeDefined();
      expect(evUpcoming?.quantity).toBe(2);
      expect(evUpcoming?.totalPriceCents).toBe(4000);
      expect(evUpcoming?.ticketNumbers).toEqual(["TICK-001", "TICK-002"]);
    });

    it("treats happening-now events as upcoming and sorts them first", () => {
      const grouped = groupTickets(sampleTickets, fixedNow);
      expect(grouped.upcoming.length).toBe(2);
      expect(grouped.upcoming[0].eventId).toBe("ev-now");
      expect(grouped.upcoming[0].howSoon).toBe("Happening now");
    });

    it("places past events into past and released tickets into other", () => {
      const grouped = groupTickets(sampleTickets, fixedNow);
      expect(grouped.past.length).toBe(1);
      expect(grouped.past[0].eventId).toBe("ev-past");

      expect(grouped.other.length).toBe(1);
      expect(grouped.other[0].eventId).toBe("ev-rel");
      expect(grouped.other[0].status).toBe("released");
    });
  });

  describe("detectScheduleOverlaps", () => {
    it("detects overlap between two events occurring at the same time", () => {
      const schedule = detectScheduleOverlaps([
        {
          eventId: "ev-a",
          eventTitle: "Event A",
          venue: "Venue A",
          city: "SF",
          timezone: "America/Los_Angeles",
          startsAt: "2026-11-20T18:00:00-08:00",
          endsAt: "2026-11-20T21:00:00-08:00",
          tierId: "t-a",
          tierName: "GA",
          quantity: 1,
          totalPriceCents: 2000,
          status: "valid",
          ticketNumbers: ["T-1"],
        },
        {
          eventId: "ev-b",
          eventTitle: "Event B",
          venue: "Venue B",
          city: "SF",
          timezone: "America/Los_Angeles",
          startsAt: "2026-11-20T19:00:00-08:00", // Starts during Event A
          endsAt: "2026-11-20T22:00:00-08:00",
          tierId: "t-b",
          tierName: "GA",
          quantity: 1,
          totalPriceCents: 2500,
          status: "valid",
          ticketNumbers: ["T-2"],
        },
      ]);

      expect(schedule.hasOverlaps).toBe(true);
      expect(schedule.events[0].overlapsWith).toContain("Event B");
      expect(schedule.events[1].overlapsWith).toContain("Event A");
    });

    it("reports no overlap when events are completely disjoint", () => {
      const schedule = detectScheduleOverlaps([
        {
          eventId: "ev-a",
          eventTitle: "Event A",
          venue: "Venue A",
          city: "SF",
          timezone: "America/Los_Angeles",
          startsAt: "2026-11-20T14:00:00-08:00",
          endsAt: "2026-11-20T16:00:00-08:00",
          tierId: "t-a",
          tierName: "GA",
          quantity: 1,
          totalPriceCents: 2000,
          status: "valid",
          ticketNumbers: ["T-1"],
        },
        {
          eventId: "ev-b",
          eventTitle: "Event B",
          venue: "Venue B",
          city: "SF",
          timezone: "America/Los_Angeles",
          startsAt: "2026-11-20T17:00:00-08:00",
          endsAt: "2026-11-20T19:00:00-08:00",
          tierId: "t-b",
          tierName: "GA",
          quantity: 1,
          totalPriceCents: 2500,
          status: "valid",
          ticketNumbers: ["T-2"],
        },
      ]);

      expect(schedule.hasOverlaps).toBe(false);
      expect(schedule.events[0].overlapsWith).toHaveLength(0);
      expect(schedule.events[1].overlapsWith).toHaveLength(0);
    });
  });

  describe("formatStandbyStatus", () => {
    it("formats wording accurately based on status", () => {
      const requests: MyStandbyRequest[] = [
        {
          id: "req-auth",
          quantity: 1,
          conditions_text: "Hold placed",
          status: "authorized",
          authorized_cents: 4000,
          authorized_at: "2026-11-10T00:00:00Z",
          expires_at: "2026-11-20T16:00:00-08:00",
          created_at: "2026-11-10T00:00:00Z",
          tiers: [{ id: "t-1", name: "General", price_cents: 4000 }],
          event: {
            id: "ev-1",
            title: "Authorized Event",
            venue: "Venue",
            city: "SF",
            timezone: "America/Los_Angeles",
            starts_at: "2026-11-20T18:00:00-08:00",
            ends_at: "2026-11-20T21:00:00-08:00",
          },
        },
        {
          id: "req-settled",
          quantity: 1,
          conditions_text: "Matched",
          status: "settled",
          authorized_cents: 3500,
          authorized_at: "2026-11-09T00:00:00Z",
          expires_at: "2026-11-15T16:00:00-08:00",
          created_at: "2026-11-09T00:00:00Z",
          tiers: [{ id: "t-2", name: "Standard", price_cents: 3500 }],
          event: {
            id: "ev-2",
            title: "Settled Event",
            venue: "Venue",
            city: "SF",
            timezone: "America/Los_Angeles",
            starts_at: "2026-11-15T18:00:00-08:00",
            ends_at: "2026-11-15T21:00:00-08:00",
          },
        },
        {
          id: "req-canc",
          quantity: 1,
          conditions_text: "Cancelled",
          status: "cancelled",
          authorized_cents: 2000,
          authorized_at: null,
          expires_at: "2026-11-12T16:00:00-08:00",
          created_at: "2026-11-05T00:00:00Z",
          tiers: [{ id: "t-3", name: "Early", price_cents: 2000 }],
          event: {
            id: "ev-3",
            title: "Cancelled Event",
            venue: "Venue",
            city: "SF",
            timezone: "America/Los_Angeles",
            starts_at: "2026-11-12T18:00:00-08:00",
            ends_at: "2026-11-12T21:00:00-08:00",
          },
        },
      ];

      const formatted = formatStandbyStatus(requests);
      expect(formatted[0].isHoldActive).toBe(true);
      expect(formatted[0].statusDescription).toContain("no upfront charge");
      expect(formatted[1].statusDescription).toContain("charged at the actual tier price");
      expect(formatted[2].statusDescription).toContain("Nothing is being held or charged");
    });
  });

  describe("Owned Event Exclusion in Discovery", () => {
    it("excludes events the user already holds a valid ticket for", () => {
      const result = findMatchingEvents(
        mockEvents,
        { topics: ["AI"], count: 3 },
        [],
        ["ev-1"], // user already holds a ticket for ev-1
      );

      expect(result.matchedEvents.some((e) => e.id === "ev-1")).toBe(false);
      expect(result.ownedExcludedCount).toBe(1);
    });
  });

  describe("Auth Gate for Persona Queries", () => {
    it("prompts to choose a demo person if no profile is logged in for my_tickets", async () => {
      const res = await planEvents(
        [{ role: "user", content: "what tickets do I have" }],
        mockEvents,
        {},
        null, // No profile
      );

      expect(res.message.requiresAuth).toBe(true);
      expect(res.message.intent).toBe("my_tickets");
      expect(res.message.content).toContain("choose a demo person");
    });

    it("prompts to choose a demo person if no profile is logged in for upcoming", async () => {
      const res = await planEvents(
        [{ role: "user", content: "which event is next" }],
        mockEvents,
        {},
        null, // No profile
      );

      expect(res.message.requiresAuth).toBe(true);
      expect(res.message.intent).toBe("upcoming");
      expect(res.message.content).toContain("choose a demo person");
    });
  });
});
