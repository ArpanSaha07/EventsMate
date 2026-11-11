import { describe, expect, it } from "vitest";
import { createSessionToken, readSessionToken } from "@/lib/session-token";

const SECRET = "a".repeat(64);
const ID = "0b9c1c1e-6c0f-4f0e-9a51-0d2f6f1f2a11";

describe("session token", () => {
  it("round-trips a profile id", () => {
    expect(readSessionToken(createSessionToken(ID, SECRET), SECRET)).toBe(ID);
  });

  it("rejects a token whose profile id was swapped", () => {
    const signature = createSessionToken(ID, SECRET).split(".")[1];
    expect(readSessionToken(`someone-else.${signature}`, SECRET)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    expect(readSessionToken(createSessionToken(ID, "b".repeat(64)), SECRET)).toBeNull();
  });

  it("rejects missing or malformed tokens", () => {
    expect(readSessionToken(undefined, SECRET)).toBeNull();
    expect(readSessionToken("", SECRET)).toBeNull();
    expect(readSessionToken("no-dot", SECRET)).toBeNull();
    expect(readSessionToken(".sig", SECRET)).toBeNull();
  });
});
