/**
 * Matching of released seats to standby requests (F5).
 *
 * Two planners feed one validator:
 * - `planAllocations`: rule-based, first come first served. Always available.
 * - the model's proposal (`matchProposalSchema`), used only when
 *   `validateProposal` accepts every pair and it fills more requests (D9, D56).
 *
 * Pure functions: the database function `begin_settlement` re-checks every
 * allocation under row locks before any money moves.
 */
import { z } from "zod";

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
  /** The fan's condition: all seats in one ticket type (D54). */
  sameTier?: boolean;
};

export type Allocation = {
  requestId: string;
  ticketIds: string[];
  captureCents: number;
  /** The agent's reason, when the allocation came from the model. */
  reason?: string;
};

const byReleased = (a: ReleasedSeat, b: ReleasedSeat) =>
  new Date(a.releasedAt).getTime() - new Date(b.releasedAt).getTime() || a.ticketId.localeCompare(b.ticketId);
const byAge = (a: QueuedRequest, b: QueuedRequest) =>
  new Date(a.authorizedAt).getTime() - new Date(b.authorizedAt).getTime() || a.id.localeCompare(b.id);

/**
 * First come, first served: the oldest request that can be filled completely
 * gets the seats released earliest. All or nothing (D50), so a request that
 * cannot be filled is skipped and a later, smaller one may be served.
 * A seat is never given to its own holder, to a tier the fan did not accept,
 * across tiers when the fan asked for one tier, or at a total above the hold.
 */
export function planAllocations(seats: ReleasedSeat[], requests: QueuedRequest[]): Allocation[] {
  const free = [...seats].sort(byReleased);
  const allocations: Allocation[] = [];

  for (const request of [...requests].sort(byAge)) {
    if (!Number.isInteger(request.quantity) || request.quantity < 1) continue;
    const eligible = free.filter(
      (seat) => seat.ownerId !== request.fanId && request.acceptedTierIds.includes(seat.tierId),
    );

    let chosen: ReleasedSeat[] = [];
    if (request.sameTier) {
      // The tier whose seats were released earliest and that has enough of them.
      for (const first of eligible) {
        const tier = eligible.filter((seat) => seat.tierId === first.tierId);
        if (tier.length >= request.quantity) {
          chosen = tier.slice(0, request.quantity);
          break;
        }
      }
    } else {
      chosen = eligible.slice(0, request.quantity);
    }
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

/** The JSON the model must return. Seats and requests are named by the short refs in the brief. */
export const matchProposalSchema = z.object({
  allocations: z.array(
    z.object({
      request: z.string(),
      seats: z.array(z.string()),
      reason: z.string(),
    }),
  ),
});

export type MatchProposal = z.infer<typeof matchProposalSchema>;

export type MatchingBrief = {
  /** The facts given to the model. Contains refs only: no ids, names or amounts of money held. */
  text: string;
  seatIds: Map<string, string>;
  requestIds: Map<string, string>;
};

/** Describes the event's released seats and waiting requests for the model, oldest first. */
export function buildMatchingBrief(
  seats: ReleasedSeat[],
  requests: QueuedRequest[],
  tierNames: Map<string, string>,
): MatchingBrief {
  const seatIds = new Map<string, string>();
  const requestIds = new Map<string, string>();
  const name = (tierId: string) => tierNames.get(tierId) ?? tierId;

  const seatLines = [...seats].sort(byReleased).map((seat, i) => {
    const ref = `S${i + 1}`;
    seatIds.set(ref, seat.ticketId);
    return `${ref}: tier "${name(seat.tierId)}", holder ${seat.ownerId.slice(0, 8)}`;
  });
  const requestLines = [...requests].sort(byAge).map((request, i) => {
    const ref = `R${i + 1}`;
    requestIds.set(ref, request.id);
    const tiers = request.acceptedTierIds.map((id) => `"${name(id)}"`).join(" or ");
    return (
      `${ref}: needs exactly ${request.quantity} seat${request.quantity === 1 ? "" : "s"}, accepts ${tiers}` +
      (request.sameTier && request.quantity > 1 ? ", all seats must be the same tier" : "") +
      `, fan ${request.fanId.slice(0, 8)}`
    );
  });

  return {
    text: `Released seats (earliest released first):\n${seatLines.join("\n")}\n\nStandby requests (oldest first):\n${requestLines.join("\n")}`,
    seatIds,
    requestIds,
  };
}

export type ProposalVerdict = { ok: true; allocations: Allocation[] } | { ok: false; problems: string[] };

/**
 * The model proposes; this decides. Every proposed pair is re-checked against
 * the real rows. One invalid pair rejects the whole proposal: a plan that was
 * wrong somewhere is not trusted elsewhere.
 */
export function validateProposal(
  raw: unknown,
  brief: Pick<MatchingBrief, "seatIds" | "requestIds">,
  seats: ReleasedSeat[],
  requests: QueuedRequest[],
): ProposalVerdict {
  const parsed = matchProposalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: ["The proposal is not in the expected form."] };

  const seatById = new Map(seats.map((seat) => [seat.ticketId, seat]));
  const requestById = new Map(requests.map((request) => [request.id, request]));
  const usedSeats = new Set<string>();
  const usedRequests = new Set<string>();
  const problems: string[] = [];
  const allocations: Allocation[] = [];

  for (const item of parsed.data.allocations) {
    const request = requestById.get(brief.requestIds.get(item.request) ?? "");
    if (!request) {
      problems.push(`${item.request}: no such standby request.`);
      continue;
    }
    if (usedRequests.has(request.id)) {
      problems.push(`${item.request}: allocated twice.`);
      continue;
    }
    usedRequests.add(request.id);

    const chosen: ReleasedSeat[] = [];
    for (const ref of item.seats) {
      const seat = seatById.get(brief.seatIds.get(ref) ?? "");
      if (!seat) problems.push(`${item.request}: ${ref} is not a released seat.`);
      else if (usedSeats.has(seat.ticketId)) problems.push(`${item.request}: ${ref} is given out twice.`);
      else if (seat.ownerId === request.fanId) problems.push(`${item.request}: ${ref} is the fan's own seat.`);
      else if (!request.acceptedTierIds.includes(seat.tierId)) {
        problems.push(`${item.request}: ${ref} is in a tier the fan did not accept.`);
      } else {
        usedSeats.add(seat.ticketId);
        chosen.push(seat);
      }
    }
    if (item.seats.length !== request.quantity) {
      problems.push(`${item.request}: needs ${request.quantity} seats, was given ${item.seats.length}.`);
    }
    if (request.sameTier && new Set(chosen.map((seat) => seat.tierId)).size > 1) {
      problems.push(`${item.request}: the fan asked for all seats in the same tier.`);
    }
    const captureCents = chosen.reduce((sum, seat) => sum + seat.priceCents, 0);
    if (captureCents > request.authorizedCents) {
      problems.push(`${item.request}: the seats cost more than the fan's hold.`);
    }

    allocations.push({
      requestId: request.id,
      ticketIds: chosen.map((seat) => seat.ticketId),
      captureCents,
      reason: item.reason.replace(/\s+/g, " ").trim().slice(0, 240) || undefined,
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  // Settle in queue order, whatever order the model listed them in.
  const age = new Map([...requests].sort(byAge).map((request, i) => [request.id, i]));
  allocations.sort((a, b) => age.get(a.requestId)! - age.get(b.requestId)!);
  return { ok: true, allocations };
}

/**
 * True when first-come leaves a waiting request unfilled, so a different
 * allocation could do better (D56). With one request, or when everyone is
 * served, there is nothing for the model to improve.
 */
export function worthAskingAgent(seats: ReleasedSeat[], requests: QueuedRequest[], baseline: Allocation[]): boolean {
  return seats.length > 0 && requests.length >= 2 && baseline.length < requests.length;
}

export type ChosenPlan = { source: "agent" | "rules"; allocations: Allocation[]; note: string };

/**
 * D9: the agent's plan is used only when it is valid and fills more requests
 * completely than first-come. On a tie first-come wins, because it favours
 * the oldest requests.
 */
export function choosePlan(baseline: Allocation[], verdict: ProposalVerdict | null): ChosenPlan {
  if (!verdict) return { source: "rules", allocations: baseline, note: "No agent proposal; first-come rules used." };
  if (!verdict.ok) {
    return {
      source: "rules",
      allocations: baseline,
      note: `Agent proposal rejected by the rules (${verdict.problems.join(" ")}); first-come used.`,
    };
  }
  if (verdict.allocations.length <= baseline.length) {
    return {
      source: "rules",
      allocations: baseline,
      note: `Agent proposal fills ${verdict.allocations.length} request(s), first-come fills ${baseline.length}; first-come used.`,
    };
  }
  return {
    source: "agent",
    allocations: verdict.allocations,
    note: `Agent proposal fills ${verdict.allocations.length} request(s), first-come would fill ${baseline.length}.`,
  };
}
