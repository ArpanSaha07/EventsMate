import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The persona cookie value is `<profileId>.<hmac>`. Signing stops a visitor
 * from acting as an arbitrary profile id by editing the cookie; it is demo
 * identity, not authentication.
 */

function sign(profileId: string, secret: string): string {
  return createHmac("sha256", secret).update(profileId).digest("base64url");
}

export function createSessionToken(profileId: string, secret: string): string {
  return `${profileId}.${sign(profileId, secret)}`;
}

/** Returns the profile id, or null if the token is missing, malformed or forged. */
export function readSessionToken(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const profileId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(profileId, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return profileId;
}
