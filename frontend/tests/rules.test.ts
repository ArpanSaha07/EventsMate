import { describe, expect, it } from "vitest";
import {
  beforeReleaseCutoff,
  isSoldOut,
  maxOrderQuantity,
  releaseBlocker,
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

describe("releaseBlocker", () => {
  const event = { starts_at: "2026-11-16T18:00:00-08:00", hasRefundRule: true };
  const before = new Date("2026-11-16T15:59:59-08:00");
  const paid = { status: "valid" as const, paidWithPayPal: true };

  it("allows a valid, PayPal-paid ticket before the cutoff when a rule is confirmed", () => {
    expect(releaseBlocker(paid, event, before)).toBeNull();
  });

  it("closes at the cutoff, two hours before the start", () => {
    expect(releaseBlocker(paid, event, new Date("2026-11-16T16:00:00-08:00"))).toMatch(/closed/);
  });

  it("refuses tickets with nothing to refund against", () => {
    expect(releaseBlocker({ ...paid, paidWithPayPal: false }, event, before)).toMatch(/PayPal/);
  });

  it("refuses when the event has no confirmed refund rule", () => {
    expect(releaseBlocker(paid, { ...event, hasRefundRule: false }, before)).toMatch(/refund rule/);
  });

  it("refuses tickets that are already released or resold", () => {
    expect(releaseBlocker({ ...paid, status: "released" }, event, before)).toMatch(/already released/);
    expect(releaseBlocker({ ...paid, status: "transferred" }, event, before)).toMatch(/resold/);
  });
});
