import { describe, expect, it } from "vitest";
import {
  buildMatchingBrief,
  choosePlan,
  planAllocations,
  validateProposal,
  worthAskingAgent,
  type QueuedRequest,
  type ReleasedSeat,
} from "@/lib/matching";

const GA = "tier-ga";
const VIP = "tier-vip";
const NAMES = new Map([
  [GA, "General"],
  [VIP, "VIP"],
]);

function seat(id: string, tierId: string, releasedAt: string, ownerId = "holder-1"): ReleasedSeat {
  return { ticketId: id, tierId, ownerId, priceCents: tierId === VIP ? 6000 : 2500, releasedAt };
}

function request(id: string, minute: number, over: Partial<QueuedRequest> = {}): QueuedRequest {
  return {
    id,
    fanId: `fan-${id}`,
    quantity: 1,
    acceptedTierIds: [GA],
    authorizedCents: 12000,
    authorizedAt: `2026-11-11T09:${String(minute).padStart(2, "0")}:00Z`,
    ...over,
  };
}

/**
 * The gate case: 2 General + 1 VIP released; three requests.
 * First-come gives the oldest request (2 seats, either tier) the General + VIP
 * released first, leaving one General: only 2 of 3 requests can be filled.
 * Giving the oldest both General seats and the VIP-only fan the VIP fills... see below.
 */
const SEATS = [
  seat("g1", GA, "2026-11-11T10:00:00Z"),
  seat("v1", VIP, "2026-11-11T10:01:00Z"),
  seat("g2", GA, "2026-11-11T10:02:00Z"),
];
const REQUESTS = [
  request("a", 0, { quantity: 2, acceptedTierIds: [GA, VIP] }),
  request("b", 1, { acceptedTierIds: [VIP] }),
  request("c", 2, { quantity: 2 }),
];

function proposalFor(pairs: [string, string[]][], brief = buildMatchingBrief(SEATS, REQUESTS, NAMES)) {
  const refOf = (map: Map<string, string>, id: string) =>
    [...map.entries()].find(([, value]) => value === id)?.[0] ?? id;
  return {
    brief,
    raw: {
      allocations: pairs.map(([requestId, ticketIds]) => ({
        request: refOf(brief.requestIds, requestId),
        seats: ticketIds.map((id) => refOf(brief.seatIds, id)),
        reason: "Serving this request leaves seats that fill another one.",
      })),
    },
  };
}

describe("first-come baseline on the multi-tier case", () => {
  it("fills only the oldest request, wasting the seat a later fan needed", () => {
    const baseline = planAllocations(SEATS, REQUESTS);
    // A takes g1 + v1 (released first). B wants VIP: gone. C wants 2 General: one left.
    expect(baseline.map((a) => [a.requestId, a.ticketIds])).toEqual([["a", ["g1", "v1"]]]);
    expect(worthAskingAgent(SEATS, REQUESTS, baseline)).toBe(true);
  });
});

describe("validateProposal and choosePlan", () => {
  it("uses a valid agent proposal that fills more requests than first-come (D9)", () => {
    // A gets both General seats, B gets the VIP: 2 requests filled instead of 1.
    const { brief, raw } = proposalFor([
      ["b", ["v1"]],
      ["a", ["g1", "g2"]],
    ]);
    const verdict = validateProposal(raw, brief, SEATS, REQUESTS);
    expect(verdict.ok).toBe(true);
    const plan = choosePlan(planAllocations(SEATS, REQUESTS), verdict);
    expect(plan.source).toBe("agent");
    // Settled in queue order, with amounts computed by code, not by the model.
    expect(plan.allocations.map((a) => [a.requestId, a.ticketIds, a.captureCents])).toEqual([
      ["a", ["g1", "g2"], 5000],
      ["b", ["v1"], 6000],
    ]);
    expect(plan.allocations[0].reason).toContain("leaves seats");
  });

  it("keeps first-come when the agent's valid proposal is no better", () => {
    const { brief, raw } = proposalFor([["c", ["g1", "g2"]]]);
    const baseline = planAllocations(SEATS, REQUESTS);
    const plan = choosePlan(baseline, validateProposal(raw, brief, SEATS, REQUESTS));
    expect(plan.source).toBe("rules");
    expect(plan.allocations).toEqual(baseline);
  });

  it("keeps first-come when there is no proposal (model unavailable)", () => {
    const baseline = planAllocations(SEATS, REQUESTS);
    expect(choosePlan(baseline, null)).toMatchObject({ source: "rules", allocations: baseline });
  });

  const invalid: [string, [string, string[]][], RegExp][] = [
    ["a tier the fan did not accept", [["b", ["g1"]], ["a", ["v1", "g2"]]], /did not accept/],
    ["a partial fill", [["a", ["g1"]], ["b", ["v1"]]], /needs 2 seats, was given 1/],
    ["a seat given to two requests", [["a", ["g1", "g2"]], ["c", ["g1", "g2"]]], /given out twice/],
    ["a seat that is not released", [["a", ["g1", "ghost"]], ["b", ["v1"]]], /not a released seat/],
    ["a request that does not exist", [["nobody", ["g1"]], ["b", ["v1"]]], /no such standby request/],
    ["the same request twice", [["b", ["v1"]], ["b", ["v1"]]], /allocated twice/],
  ];
  for (const [name, pairs, problem] of invalid) {
    it(`rejects the whole proposal for ${name} and falls back to first-come`, () => {
      const { brief, raw } = proposalFor(pairs);
      const verdict = validateProposal(raw, brief, SEATS, REQUESTS);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.problems.join(" ")).toMatch(problem);
      const baseline = planAllocations(SEATS, REQUESTS);
      const plan = choosePlan(baseline, verdict);
      expect(plan.source).toBe("rules");
      expect(plan.allocations).toEqual(baseline);
    });
  }

  it("rejects a proposal that gives a fan their own released seat", () => {
    const seats = [seat("g1", GA, "2026-11-11T10:00:00Z", "fan-a")];
    const requests = [request("a", 0), request("b", 1)];
    const { brief, raw } = proposalFor([["a", ["g1"]]], buildMatchingBrief(seats, requests, NAMES));
    const verdict = validateProposal(raw, brief, seats, requests);
    expect(verdict.ok).toBe(false);
  });

  it("rejects a proposal that costs more than the fan's hold", () => {
    const requests = [request("a", 0, { acceptedTierIds: [GA, VIP], authorizedCents: 2500 }), request("b", 1)];
    const { brief, raw } = proposalFor([["a", ["v1"]]], buildMatchingBrief(SEATS, requests, NAMES));
    const verdict = validateProposal(raw, brief, SEATS, requests);
    expect(verdict).toMatchObject({ ok: false });
  });

  it("rejects a proposal that mixes tiers for a fan who asked for one tier (D54)", () => {
    const requests = [request("a", 0, { quantity: 2, acceptedTierIds: [GA, VIP], sameTier: true }), request("b", 1)];
    const { brief, raw } = proposalFor([["a", ["g1", "v1"]]], buildMatchingBrief(SEATS, requests, NAMES));
    const verdict = validateProposal(raw, brief, SEATS, requests);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.problems.join(" ")).toMatch(/same tier/);
  });

  it("rejects output that is not in the expected form", () => {
    const brief = buildMatchingBrief(SEATS, REQUESTS, NAMES);
    expect(validateProposal({ allocations: "all of them" }, brief, SEATS, REQUESTS).ok).toBe(false);
    expect(validateProposal(null, brief, SEATS, REQUESTS).ok).toBe(false);
  });
});

describe("same-tier condition in the first-come rules", () => {
  it("skips mixed tiers and takes the first tier with enough seats", () => {
    const requests = [request("a", 0, { quantity: 2, acceptedTierIds: [GA, VIP], sameTier: true })];
    expect(planAllocations(SEATS, requests)).toEqual([
      { requestId: "a", ticketIds: ["g1", "g2"], captureCents: 5000 },
    ]);
  });

  it("leaves the request waiting when no single tier has enough seats", () => {
    const requests = [request("a", 0, { quantity: 2, acceptedTierIds: [GA, VIP], sameTier: true })];
    expect(planAllocations(SEATS.slice(0, 2), requests)).toEqual([]);
  });
});

describe("worthAskingAgent (D56)", () => {
  it("is false with a single request or when first-come serves everyone", () => {
    const one = [request("a", 0)];
    expect(worthAskingAgent(SEATS, one, planAllocations(SEATS, one))).toBe(false);
    const two = [request("a", 0), request("b", 1)];
    expect(worthAskingAgent(SEATS, two, planAllocations(SEATS, two))).toBe(false);
    expect(worthAskingAgent([], REQUESTS, [])).toBe(false);
  });
});

describe("buildMatchingBrief", () => {
  it("names seats and requests by short refs, oldest first, with the fan's condition", () => {
    const requests = [request("late", 5), request("early", 0, { quantity: 2, acceptedTierIds: [GA, VIP], sameTier: true })];
    const brief = buildMatchingBrief(SEATS, requests, NAMES);
    expect(brief.requestIds.get("R1")).toBe("early");
    expect(brief.seatIds.get("S2")).toBe("v1");
    expect(brief.text).toContain('R1: needs exactly 2 seats, accepts "General" or "VIP", all seats must be the same tier');
    expect(brief.text).toContain('S2: tier "VIP"');
  });
});
