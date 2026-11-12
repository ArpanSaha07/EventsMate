import { describe, expect, it } from "vitest";
import { checkConditions, effectiveExpiry, parseStandbyConditions, zonedTimeToUtc } from "@/lib/conditions";

const LA = "America/Los_Angeles";
const NOW = new Date("2026-11-11T20:00:00Z"); // Wed Nov 11, 12:00 PST
const NOTE = "Only if both seats are in the same tier. I need to know by Thursday 6 pm. Aisle seats please!";

const reading = (over: Record<string, unknown> = {}) => ({
  same_tier: true,
  same_tier_quote: "both seats are in the same tier",
  decide_by_local: "2026-11-12T18:00",
  decide_by_quote: "I need to know by Thursday 6 pm",
  unsupported: ["Aisle seats please!"],
  ...over,
});

describe("zonedTimeToUtc", () => {
  it("converts a wall-clock time in the event's timezone", () => {
    expect(zonedTimeToUtc("2026-11-12T18:00", LA)?.toISOString()).toBe("2026-11-13T02:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-01T09:30", LA)?.toISOString()).toBe("2026-07-01T16:30:00.000Z");
    expect(zonedTimeToUtc("2026-11-12T18:00", "UTC")?.toISOString()).toBe("2026-11-12T18:00:00.000Z");
  });

  it("rejects anything that is not YYYY-MM-DDTHH:mm", () => {
    expect(zonedTimeToUtc("Thursday 6 pm", LA)).toBeNull();
    expect(zonedTimeToUtc("2026-13-40T25:00", LA)).toBeNull();
  });
});

describe("checkConditions", () => {
  it("accepts conditions the model quotes from the note, and lists the rest as not enforced", () => {
    expect(checkConditions(reading(), NOTE, { timezone: LA, now: NOW })).toEqual({
      version: 1,
      same_tier: true,
      decide_by: "2026-11-13T02:00:00.000Z",
      unsupported: ["Aisle seats please!"],
    });
  });

  it("does not enforce a condition the note does not actually say", () => {
    const result = checkConditions(
      reading({ same_tier_quote: "must all be VIP together", unsupported: [] }),
      NOTE,
      { timezone: LA, now: NOW },
    );
    expect(result.same_tier).toBe(false);
  });

  it("does not accept a deadline without a quote, in the past, or malformed", () => {
    const context = { timezone: LA, now: NOW };
    expect(checkConditions(reading({ decide_by_quote: null }), NOTE, context).decide_by).toBeNull();
    const past = checkConditions(reading({ decide_by_local: "2026-11-10T18:00" }), NOTE, context);
    expect(past.decide_by).toBeNull();
    // The fan's words are kept so they can see the deadline was not taken.
    expect(past.unsupported).toContain("I need to know by Thursday 6 pm");
    expect(checkConditions(reading({ decide_by_local: "soon" }), NOTE, context).decide_by).toBeNull();
  });

  it("drops 'unsupported' text the model made up", () => {
    const result = checkConditions(reading({ unsupported: ["wants a refund guarantee"] }), NOTE, {
      timezone: LA,
      now: NOW,
    });
    expect(result.unsupported).toEqual([]);
  });

  it("reads a note with no conditions as none", () => {
    const result = checkConditions(
      { same_tier: false, same_tier_quote: null, decide_by_local: null, decide_by_quote: null, unsupported: [] },
      "Thanks!",
      { timezone: LA, now: NOW },
    );
    expect(result).toEqual({ version: 1, same_tier: false, decide_by: null, unsupported: [] });
  });

  it("throws on output that is not in the expected form, so the note stays unread", () => {
    expect(() => checkConditions({ same_tier: "yes" }, NOTE, { timezone: LA, now: NOW })).toThrow();
  });
});

describe("effectiveExpiry", () => {
  const cutoff = "2026-11-20T15:30:00.000Z";
  it("ends the request at the fan's deadline when that is before the cutoff", () => {
    const conditions = { version: 1 as const, same_tier: false, decide_by: "2026-11-13T02:00:00.000Z", unsupported: [] };
    expect(effectiveExpiry(cutoff, conditions).toISOString()).toBe("2026-11-13T02:00:00.000Z");
  });
  it("never extends past the release cutoff", () => {
    const conditions = { version: 1 as const, same_tier: false, decide_by: "2026-12-01T00:00:00.000Z", unsupported: [] };
    expect(effectiveExpiry(cutoff, conditions).toISOString()).toBe(cutoff);
    expect(effectiveExpiry(cutoff, null).toISOString()).toBe(cutoff);
  });
});

describe("parseStandbyConditions", () => {
  it("returns null for missing or malformed stored values", () => {
    expect(parseStandbyConditions(null)).toBeNull();
    expect(parseStandbyConditions({ same_tier: true })).toBeNull();
  });
});
