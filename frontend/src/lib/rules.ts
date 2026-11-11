/** Product rules that are pure functions of data. Shared by server and client. */

/** D24: at most this many tickets in one order. */
export const MAX_TICKETS_PER_ORDER = 4;

/** D26: releases and standby end this long before the event starts. */
export const RELEASE_CUTOFF_MS = 2 * 60 * 60 * 1000;

export function seatsLeft(tier: { capacity: number; sold_count: number }): number {
  return Math.max(0, tier.capacity - tier.sold_count);
}

export function isSoldOut(tier: { capacity: number; sold_count: number }): boolean {
  return seatsLeft(tier) === 0;
}

/** Largest quantity one order may contain for this tier right now. */
export function maxOrderQuantity(tier: { capacity: number; sold_count: number }): number {
  return Math.min(MAX_TICKETS_PER_ORDER, seatsLeft(tier));
}

/** The moment after which seats can no longer be released or matched. */
export function releaseCutoff(startsAt: string | Date): Date {
  return new Date(new Date(startsAt).getTime() - RELEASE_CUTOFF_MS);
}

/** Ticket sales stop when the event starts. */
export function salesOpen(startsAt: string | Date, now: Date = new Date()): boolean {
  return now.getTime() < new Date(startsAt).getTime();
}

export function beforeReleaseCutoff(startsAt: string | Date, now: Date = new Date()): boolean {
  return now.getTime() < releaseCutoff(startsAt).getTime();
}
