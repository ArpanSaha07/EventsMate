/**
 * Rule-based matching of released seats to standby requests (F5).
 * Pure functions: the database function `begin_settlement` re-checks every
 * allocation under row locks before any money moves.
 */

export type ReleasedSeat = {
  ticketId: string;
  tierId: string;
  ownerId: string;
  /** What a fan pays for this seat: the tier's face price (D28). */
  priceCents: number;
  releasedAt: string;
};

export type QueuedRequest = {
  id: string;
  fanId: string;
  quantity: number;
  acceptedTierIds: string[];
  /** The PayPal hold. A capture may never exceed it. */
  authorizedCents: number;
  authorizedAt: string;
};

export type Allocation = { requestId: string; ticketIds: string[]; captureCents: number };

/**
 * First come, first served: the oldest request that can be filled completely
 * gets the seats released earliest. All or nothing (D50), so a request that
 * cannot be filled is skipped and a later, smaller one may be served.
 * A seat is never given to its own holder, to a tier the fan did not accept,
 * or at a total above the fan's hold.
 */
export function planAllocations(seats: ReleasedSeat[], requests: QueuedRequest[]): Allocation[] {
  const free = [...seats].sort(
    (a, b) =>
      new Date(a.releasedAt).getTime() - new Date(b.releasedAt).getTime() ||
      a.ticketId.localeCompare(b.ticketId),
  );
  const queue = [...requests].sort(
    (a, b) =>
      new Date(a.authorizedAt).getTime() - new Date(b.authorizedAt).getTime() || a.id.localeCompare(b.id),
  );

  const allocations: Allocation[] = [];
  for (const request of queue) {
    if (!Number.isInteger(request.quantity) || request.quantity < 1) continue;
    const chosen = free
      .filter((seat) => seat.ownerId !== request.fanId && request.acceptedTierIds.includes(seat.tierId))
      .slice(0, request.quantity);
    if (chosen.length < request.quantity) continue;

    const captureCents = chosen.reduce((sum, seat) => sum + seat.priceCents, 0);
    if (captureCents <= 0 || captureCents > request.authorizedCents) continue;

    for (const seat of chosen) free.splice(free.indexOf(seat), 1);
    allocations.push({
      requestId: request.id,
      ticketIds: chosen.map((seat) => seat.ticketId),
      captureCents,
    });
  }
  return allocations;
}
