import { describe, expect, it } from "vitest";
import { centsToDecimalString, decimalStringToCents } from "@/lib/money";

describe("money", () => {
  it("formats integer cents as a PayPal decimal string", () => {
    expect(centsToDecimalString(4500)).toBe("45.00");
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(0)).toBe("0.00");
  });

  it("rejects non-integer or negative amounts", () => {
    expect(() => centsToDecimalString(10.5)).toThrow();
    expect(() => centsToDecimalString(-1)).toThrow();
  });

  it("parses PayPal decimal strings without float drift", () => {
    expect(decimalStringToCents("45.00")).toBe(4500);
    expect(decimalStringToCents("0.29")).toBe(29);
    expect(decimalStringToCents("19.9")).toBe(1990);
    expect(decimalStringToCents("12")).toBe(1200);
  });

  it("returns null for malformed amounts", () => {
    expect(decimalStringToCents(undefined)).toBeNull();
    expect(decimalStringToCents("1.234")).toBeNull();
    expect(decimalStringToCents("-5.00")).toBeNull();
    expect(decimalStringToCents("abc")).toBeNull();
  });
});
