import { describe, expect, it } from "vitest";
import { planAllocations, type QueuedRequest, type ReleasedSeat } from "@/lib/matching";

const GA = "tier-ga";
const VIP = "tier-vip";

function seat(id: string, over: Partial<ReleasedSeat> = {}): ReleasedSeat {
  return {
    ticketId: id,
    tierId: GA,
    ownerId: "holder-1",
    priceCents: 2500,
    releasedAt: "2026-11-11T10:00:00Z",
    ...over,
  };
}

function request(id: string, over: Partial<QueuedRequest> = {}): QueuedRequest {
  return {
    id,
    fanId: `fan-${id}`,
    quantity: 1,
    acceptedTierIds: [GA],
    authorizedCents: 2500,
    authorizedAt: "2026-11-11T09:00:00Z",
    ...over,
  };
}

describe("planAllocations", () => {
  it("gives one released seat to the one waiting fan at the tier's price", () => {
    expect(planAllocations([seat("t1")], [request("r1")])).toEqual([
      { requestId: "r1", ticketIds: ["t1"], captureCents: 2500 },
    ]);
  });

  it("returns nothing when there are no seats or no requests", () => {
    expect(planAllocations([], [request("r1")])).toEqual([]);
    expect(planAllocations([seat("t1")], [])).toEqual([]);
  });

  it("serves the oldest request first", () => {
    const plan = planAllocations(
      [seat("t1")],
      [request("late", { authorizedAt: "2026-11-11T09:30:00Z" }), request("early")],
    );
    expect(plan).toEqual([{ requestId: "early", ticketIds: ["t1"], captureCents: 2500 }]);
  });

  it("is all or nothing: a request that cannot be filled is skipped for a later, smaller one (D50)", () => {
    const plan = planAllocations(
      [seat("t1")],
      [
        request("wants-two", { quantity: 2, authorizedCents: 5000 }),
        request("wants-one", { authorizedAt: "2026-11-11T09:30:00Z" }),
      ],
    );
    expect(plan).toEqual([{ requestId: "wants-one", ticketIds: ["t1"], captureCents: 2500 }]);
  });

  it("fills a multi-seat request with the seats released earliest and sums their prices", () => {
    const plan = planAllocations(
      [
        seat("newest", { releasedAt: "2026-11-11T12:00:00Z" }),
        seat("oldest", { releasedAt: "2026-11-11T08:00:00Z" }),
        seat("middle", { releasedAt: "2026-11-11T10:00:00Z", tierId: VIP, priceCents: 6000 }),
      ],
      [request("r1", { quantity: 2, acceptedTierIds: [GA, VIP], authorizedCents: 12000 })],
    );
    expect(plan).toEqual([{ requestId: "r1", ticketIds: ["oldest", "middle"], captureCents: 8500 }]);
  });

  it("never gives a seat to two requests", () => {
    const plan = planAllocations(
      [seat("t1"), seat("t2", { releasedAt: "2026-11-11T11:00:00Z" })],
      [request("r1"), request("r2", { authorizedAt: "2026-11-11T09:10:00Z" }), request("r3", { authorizedAt: "2026-11-11T09:20:00Z" })],
    );
    expect(plan.map((a) => [a.requestId, a.ticketIds])).toEqual([
      ["r1", ["t1"]],
      ["r2", ["t2"]],
    ]);
  });

  it("only uses tiers the fan accepted", () => {
    expect(planAllocations([seat("t1", { tierId: VIP })], [request("r1")])).toEqual([]);
  });

  it("never matches a holder's released seat to their own standby request", () => {
    const plan = planAllocations(
      [seat("t1", { ownerId: "maya" })],
      [request("mine", { fanId: "maya" }), request("other", { authorizedAt: "2026-11-11T09:30:00Z" })],
    );
    expect(plan).toEqual([{ requestId: "other", ticketIds: ["t1"], captureCents: 2500 }]);
  });

  it("never plans a capture above the fan's hold", () => {
    // The tier price rose after the hold was placed.
    expect(planAllocations([seat("t1", { priceCents: 3000 })], [request("r1")])).toEqual([]);
  });

  it("captures less than the hold when the cheaper accepted tier is released", () => {
    const plan = planAllocations(
      [seat("t1")],
      [request("r1", { acceptedTierIds: [GA, VIP], authorizedCents: 6000 })],
    );
    expect(plan[0].captureCents).toBe(2500);
  });
});
