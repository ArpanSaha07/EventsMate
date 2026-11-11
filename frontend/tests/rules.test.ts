import { describe, expect, it } from "vitest";
import {
  beforeReleaseCutoff,
  isSoldOut,
  maxOrderQuantity,
  releaseCutoff,
  salesOpen,
  seatsLeft,
} from "@/lib/rules";

describe("availability", () => {
  it("counts seats left and never goes negative", () => {
    expect(seatsLeft({ capacity: 40, sold_count: 37 })).toBe(3);
    expect(seatsLeft({ capacity: 40, sold_count: 40 })).toBe(0);
    expect(seatsLeft({ capacity: 40, sold_count: 41 })).toBe(0);
  });

  it("flags sold-out tiers", () => {
    expect(isSoldOut({ capacity: 8, sold_count: 8 })).toBe(true);
    expect(isSoldOut({ capacity: 8, sold_count: 7 })).toBe(false);
  });

  it("caps an order at 4 tickets and at the seats left", () => {
    expect(maxOrderQuantity({ capacity: 120, sold_count: 64 })).toBe(4);
    expect(maxOrderQuantity({ capacity: 40, sold_count: 38 })).toBe(2);
    expect(maxOrderQuantity({ capacity: 40, sold_count: 40 })).toBe(0);
  });
});

describe("timing", () => {
  const start = "2026-11-16T18:00:00-08:00";

  it("puts the release cutoff two hours before the start", () => {
    expect(releaseCutoff(start).toISOString()).toBe(new Date("2026-11-16T16:00:00-08:00").toISOString());
  });

  it("closes releases at the cutoff and sales at the start", () => {
    expect(beforeReleaseCutoff(start, new Date("2026-11-16T15:59:59-08:00"))).toBe(true);
    expect(beforeReleaseCutoff(start, new Date("2026-11-16T16:00:00-08:00"))).toBe(false);
    expect(salesOpen(start, new Date("2026-11-16T17:59:59-08:00"))).toBe(true);
    expect(salesOpen(start, new Date("2026-11-16T18:00:00-08:00"))).toBe(false);
  });
});
