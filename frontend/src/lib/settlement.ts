import "server-only";
import { planAllocations, type QueuedRequest, type ReleasedSeat } from "@/lib/matching";
import { captureAuthorization, refundCapture, voidAuthorization } from "@/lib/paypal/orders";
import { applicableClause, describeTerms, parseRefundRule, refundAmountCents } from "@/lib/refund-rule";
import { beforeReleaseCutoff } from "@/lib/rules";
import {
  settleRequest,
  type SettleOutcome,
  type SettlementDeps,
  type SettlementItem,
  type SettlementState,
} from "@/lib/settlement-flow";
import { expireDueStandbyRequests } from "@/lib/standby";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { returnUnmatchedTickets } from "@/lib/tickets";

/** A capture failure frees seats for the next request, so planning repeats. This bounds it. */
const MAX_ROUNDS = 10;

const store: SettlementDeps["store"] = {
  async load(requestId) {
    const db = supabaseAdmin();
    const { data: request, error } = await db
      .from("standby_requests")
      .select("id,status,authorization_id,event:events(title)")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw new Error(`Could not load standby request: ${error.message}`);
    if (!request) return null;

    const { data: rows, error: rowsError } = await db
      .from("settlements")
      .select("id,status,price_cents,refund_cents,refund_id,ticket:tickets!ticket_id(ticket_number,source_capture_id)")
      .eq("request_id", requestId)
      .order("created_at")
      .order("id");
    if (rowsError) throw new Error(`Could not load settlements: ${rowsError.message}`);

    type Row = {
      id: string;
      status: SettlementItem["status"];
      price_cents: number;
      refund_cents: number;
      refund_id: string | null;
      ticket: { ticket_number: string; source_capture_id: string | null };
    };
    return {
      requestId: request.id,
      requestStatus: request.status,
      authorizationId: request.authorization_id,
      eventTitle: (request.event as unknown as { title: string }).title,
      items: (rows as unknown as Row[]).map((row) => ({
        id: row.id,
        status: row.status,
        ticketNumber: row.ticket.ticket_number,
        priceCents: row.price_cents,
        refundCents: row.refund_cents,
        holderCaptureId: row.ticket.source_capture_id,
        refundId: row.refund_id,
      })),
    } satisfies SettlementState;
  },
  async recordCapture(requestId, captureId, amountCents) {
    const { error } = await supabaseAdmin().rpc("record_settlement_capture", {
      p_request_id: requestId,
      p_capture_id: captureId,
      p_amount_cents: amountCents,
    });
    if (error) throw new Error(`record_settlement_capture failed: ${error.message}`);
  },
  async failCapture(requestId, reason) {
    const { error } = await supabaseAdmin().rpc("fail_settlement_capture", {
      p_request_id: requestId,
      p_reason: reason,
    });
    if (error) throw new Error(`fail_settlement_capture failed: ${error.message}`);
  },
  async recordRefundFailure(settlementId, reason) {
    const { error } = await supabaseAdmin().rpc("record_settlement_refund_failure", {
      p_settlement_id: settlementId,
      p_reason: reason,
    });
    if (error) throw new Error(`record_settlement_refund_failure failed: ${error.message}`);
  },
  async complete(settlementId, refundId, refundCents) {
    const { error } = await supabaseAdmin().rpc("complete_settlement", {
      p_settlement_id: settlementId,
      p_refund_id: refundId,
      p_refund_cents: refundCents,
    });
    if (error) throw new Error(`complete_settlement failed: ${error.message}`);
  },
  async markRefunded(settlementId, refundId) {
    const { error } = await supabaseAdmin()
      .from("settlements")
      .update({ status: "refunded", refund_id: refundId, refunded_at: new Date().toISOString() })
      .eq("id", settlementId)
      .in("status", ["captured", "refund_failed"]);
    if (error) throw new Error(`Could not keep refund id: ${error.message}`);
  },
};

const deps: SettlementDeps = {
  store,
  paypal: {
    capture: captureAuthorization,
    // Keyed by the settlement row, so a retry can never refund the same resale twice.
    refund: (captureId, amountCents, key, note) => refundCapture(captureId, amountCents, `resale-${key}`, note),
    voidHold: voidAuthorization,
  },
};

type PlannedItem = { ticket_id: string; refund_cents: number; refund_terms: string; refund_quote: string };

/** Reads the event's released seats and waiting requests and plans who gets what. */
async function planEvent(eventId: string): Promise<{ requestId: string; items: PlannedItem[] }[]> {
  const db = supabaseAdmin();

  const { data: event, error: eventError } = await db
    .from("events")
    .select("id,status,starts_at")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) throw new Error(`Could not load event: ${eventError.message}`);
  if (!event || event.status !== "published" || !beforeReleaseCutoff(event.starts_at)) return [];

  const [tickets, live, requests] = await Promise.all([
    db
      .from("tickets")
      .select("id,owner_id,tier_id,unit_price_cents,released_at,release_rule,tier:ticket_tiers(price_cents)")
      .eq("event_id", eventId)
      .eq("status", "released")
      .not("source_capture_id", "is", null),
    db.from("settlements").select("ticket_id").eq("event_id", eventId).neq("status", "capture_failed"),
    db
      .from("standby_requests")
      .select("id,fan_id,quantity,accepted_tier_ids,authorized_cents,authorized_at")
      .eq("event_id", eventId)
      .eq("status", "authorized")
      .not("authorization_id", "is", null)
      .gt("expires_at", new Date().toISOString()),
  ]);
  for (const result of [tickets, live, requests]) {
    if (result.error) throw new Error(`Could not load matching data: ${result.error.message}`);
  }

  type TicketRow = {
    id: string;
    owner_id: string;
    tier_id: string;
    unit_price_cents: number;
    released_at: string;
    release_rule: unknown;
    tier: { price_cents: number };
  };
  const busy = new Set((live.data ?? []).map((row) => row.ticket_id as string));
  const now = new Date();
  const refunds = new Map<string, PlannedItem>();
  const seats: ReleasedSeat[] = [];
  for (const row of (tickets.data ?? []) as unknown as TicketRow[]) {
    if (busy.has(row.id)) continue;
    // D35, D36: the refund is what the rule copied at release gives at this moment.
    const rule = parseRefundRule(row.release_rule);
    if (!rule) continue;
    const clause = applicableClause(rule, { tierId: row.tier_id, startsAt: event.starts_at }, now);
    const refundCents = refundAmountCents(row.unit_price_cents, clause);
    if (refundCents <= 0 || refundCents > row.unit_price_cents || row.tier.price_cents <= 0) continue;

    refunds.set(row.id, {
      ticket_id: row.id,
      refund_cents: refundCents,
      refund_terms: describeTerms(clause),
      refund_quote: clause.quote,
    });
    seats.push({
      ticketId: row.id,
      tierId: row.tier_id,
      ownerId: row.owner_id,
      priceCents: row.tier.price_cents,
      releasedAt: row.released_at,
    });
  }

  const queue: QueuedRequest[] = (requests.data ?? []).map((row) => ({
    id: row.id,
    fanId: row.fan_id,
    quantity: row.quantity,
    acceptedTierIds: row.accepted_tier_ids,
    authorizedCents: row.authorized_cents,
    authorizedAt: row.authorized_at,
  }));

  return planAllocations(seats, queue).map((allocation) => ({
    requestId: allocation.requestId,
    items: allocation.ticketIds.map((id) => refunds.get(id)!),
  }));
}

export type MatchingSummary = Record<SettleOutcome, number>;

/**
 * D51: called after a release and after a standby hold is placed. Finishes any
 * settlement left in progress for the event, then matches released seats to
 * waiting requests and settles each match. Safe to run at any time and
 * concurrently: every step is idempotent and claims are made under row locks.
 */
export async function runMatching(eventId: string): Promise<MatchingSummary> {
  const db = supabaseAdmin();
  const summary: MatchingSummary = {
    settled: 0,
    capture_failed: 0,
    capture_unconfirmed: 0,
    refund_pending: 0,
    not_matched: 0,
  };

  await returnUnmatchedTickets({ eventId });
  await expireDueStandbyRequests({ eventId });

  const { data: inProgress, error } = await db
    .from("standby_requests")
    .select("id")
    .eq("event_id", eventId)
    .eq("status", "matched");
  if (error) throw new Error(`Could not load settlements in progress: ${error.message}`);
  for (const row of inProgress ?? []) summary[await settleRequest(deps, row.id)] += 1;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const plan = await planEvent(eventId);
    let claimed = 0;
    for (const allocation of plan) {
      const { error: claimError } = await db.rpc("begin_settlement", {
        p_request_id: allocation.requestId,
        p_items: allocation.items,
      });
      if (claimError) {
        // Something changed since planning (taken back, cancelled, claimed by another run).
        console.warn("begin_settlement declined:", allocation.requestId, claimError.message);
        continue;
      }
      claimed += 1;
      summary[await settleRequest(deps, allocation.requestId)] += 1;
    }
    if (claimed === 0) break;
  }
  return summary;
}

/**
 * Matching must never turn a successful release or hold into an error: the
 * seat is released and the hold is placed either way, and the next run retries.
 */
export async function runMatchingQuietly(eventId: string): Promise<MatchingSummary | null> {
  try {
    return await runMatching(eventId);
  } catch (err) {
    console.error("Matching failed for event", eventId, err);
    return null;
  }
}
