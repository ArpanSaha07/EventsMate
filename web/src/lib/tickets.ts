import "server-only";
import { AppError } from "@/lib/errors";
import { describeTerms, parseRefundRule, previewRefund, type RefundRule } from "@/lib/refund-rule";
import { releaseBlocker, releaseCutoff } from "@/lib/rules";
import type { Profile } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MyTicket, TicketRefund, TicketResale, TicketStatus } from "@/lib/types";

/** Most tickets one release may contain. */
export const MAX_TICKETS_PER_RELEASE = 20;

const TICKET_COLUMNS =
  "id,owner_id,ticket_number,status,unit_price_cents,created_at,released_at,returned_at,release_rule,source_capture_id," +
  "tier:ticket_tiers(id,name)," +
  "event:events(id,title,venue,city,timezone,starts_at,ends_at,status,refund_rule)";

type TicketRow = {
  id: string;
  owner_id: string;
  ticket_number: string;
  status: TicketStatus;
  unit_price_cents: number;
  created_at: string;
  released_at: string | null;
  returned_at: string | null;
  release_rule: unknown;
  source_capture_id: string | null;
  tier: { id: string; name: string };
  event: MyTicket["event"] & { status: string; refund_rule: unknown };
};

function refundFor(rule: RefundRule, row: TicketRow, now: Date): TicketRefund {
  const preview = previewRefund(
    rule,
    { tierId: row.tier.id, unitPriceCents: row.unit_price_cents, startsAt: row.event.starts_at },
    now,
    releaseCutoff(row.event.starts_at),
  );
  return {
    refund_cents: preview.refundCents,
    terms: describeTerms(preview.clause),
    quote: preview.clause.quote,
    next: preview.next && {
      at: preview.next.at,
      refund_cents: preview.next.refundCents,
      terms: describeTerms(preview.next.clause),
    },
  };
}

type Extras = { resale: TicketResale | null; fromStandby: boolean };
const NO_EXTRAS: Extras = { resale: null, fromStandby: false };

/** Shapes a row for its holder. Every amount shown in the UI is computed here. */
function toMyTicket(row: TicketRow, now: Date, extras: Extras = NO_EXTRAS): MyTicket {
  // D36: a released seat is paid under the rule copied at release.
  const rule = parseRefundRule(row.status === "released" ? row.release_rule : row.event.refund_rule);
  const refund = rule ? refundFor(rule, row, now) : null;

  let blocked = releaseBlocker(
    { status: row.status, paidWithPayPal: row.source_capture_id !== null },
    { starts_at: row.event.starts_at, hasRefundRule: rule !== null },
    now,
  );
  if (!blocked && row.event.status !== "published") blocked = "This event is no longer running.";
  // D44: never offer a release that would pay nothing.
  if (!blocked && (!refund || refund.refund_cents <= 0)) {
    blocked = "This event's refund rule would pay nothing for this ticket. Ask the organiser to fix it.";
  }

  const { status: _eventStatus, refund_rule: _eventRule, ...event } = row.event;
  void _eventStatus;
  void _eventRule;
  return {
    id: row.id,
    ticket_number: row.ticket_number,
    status: row.status,
    unit_price_cents: row.unit_price_cents,
    created_at: row.created_at,
    released_at: row.released_at,
    returned_at: row.returned_at,
    release_blocked: blocked,
    refund,
    release_cutoff_at: releaseCutoff(row.event.starts_at).toISOString(),
    resale: extras.resale,
    from_standby: extras.fromStandby,
    tier: row.tier,
    event,
  };
}

/**
 * D38: returns released tickets whose cutoff has passed to their holders.
 * Call before reading tickets or released seats so nothing stale is shown or matched.
 */
export async function returnUnmatchedTickets(filter: { ownerId?: string; eventId?: string } = {}): Promise<void> {
  const { error } = await supabaseAdmin().rpc("return_unmatched_tickets", {
    p_owner_id: filter.ownerId ?? null,
    p_event_id: filter.eventId ?? null,
  });
  if (error) throw new Error(`Could not return unmatched tickets: ${error.message}`);
}

/**
 * The holder's tickets, soonest event first: valid, released, and resold ones
 * (kept so the holder can see what they were refunded).
 */
export async function listMyTickets(owner: Profile): Promise<MyTicket[]> {
  await returnUnmatchedTickets({ ownerId: owner.id });
  const db = supabaseAdmin();

  const [tickets, sold, bought] = await Promise.all([
    db
      .from("tickets")
      .select(TICKET_COLUMNS)
      .eq("owner_id", owner.id)
      .in("status", ["valid", "released", "transferred"])
      .order("created_at", { ascending: true }),
    db
      .from("settlements")
      .select("ticket_id,status,refund_cents,refund_terms,refund_id,completed_at")
      .eq("holder_id", owner.id)
      .neq("status", "capture_failed"),
    db.from("settlements").select("new_ticket_id").eq("fan_id", owner.id).eq("status", "transferred"),
  ]);
  for (const result of [tickets, sold, bought]) {
    if (result.error) throw new Error(`Could not load tickets: ${result.error.message}`);
  }

  const resales = new Map<string, TicketResale>();
  for (const row of sold.data ?? []) {
    const done = row.status === "transferred";
    resales.set(row.ticket_id, {
      // The fan may already be charged, but the holder is told "resold" only once refunded.
      state: done ? "resold" : "in_progress",
      refund_cents: row.refund_cents,
      refund_terms: row.refund_terms,
      refund_id: done ? row.refund_id : null,
      resold_at: done ? row.completed_at : null,
    });
  }
  const fromStandby = new Set((bought.data ?? []).map((row) => row.new_ticket_id as string));

  const now = new Date();
  return (tickets.data as unknown as TicketRow[])
    .map((row) =>
      toMyTicket(row, now, { resale: resales.get(row.id) ?? null, fromStandby: fromStandby.has(row.id) }),
    )
    .sort((a, b) => new Date(a.event.starts_at).getTime() - new Date(b.event.starts_at).getTime());
}

/** Database function errors the holder can act on. Anything else is a 500. */
const RELEASE_ERRORS: Record<string, [status: number, message: string]> = {
  ticket_not_found: [404, "One of those tickets was not found."],
  mixed_events: [400, "Release tickets for one event at a time."],
  event_unavailable: [409, "This event is no longer running."],
  release_closed: [409, "Releases for this event closed 2 hours before the start."],
  no_refund_rule: [409, "The organiser has not confirmed a refund rule for this event yet, so seats cannot be released."],
  ticket_not_releasable: [409, "One of those tickets has already been resold."],
  ticket_not_refundable: [409, "One of those tickets has no PayPal payment behind it, so it cannot be released."],
  ticket_resold: [409, "This seat was just resold, so it can no longer be taken back."],
  ticket_in_settlement: [409, "This seat is being resold right now, so it can no longer be taken back."],
};

function fromRpcError(message: string, context: string): Error {
  const code = Object.keys(RELEASE_ERRORS).find((key) => message.includes(key));
  if (!code) return new Error(`${context}: ${message}`);
  const [status, text] = RELEASE_ERRORS[code];
  return new AppError(status, code, text);
}

export type ReleaseOutcome = {
  /** Tickets newly released by this call (0 on a repeat). */
  releasedCount: number;
  eventId: string;
};

/**
 * Releases the holder's tickets for one event. Friendly checks run first; the
 * database function re-checks everything under row locks and is what counts.
 * Safe to call again: already-released tickets are left as they are.
 */
export async function releaseTickets(owner: Profile, ticketIds: string[]): Promise<ReleaseOutcome> {
  const db = supabaseAdmin();
  const ids = [...new Set(ticketIds)];
  await returnUnmatchedTickets({ ownerId: owner.id });

  const { data, error } = await db.from("tickets").select(TICKET_COLUMNS).in("id", ids);
  if (error) throw new Error(`Could not load tickets: ${error.message}`);
  const rows = data as unknown as TicketRow[];
  // Same answer for "missing" and "someone else's" so ids cannot be probed.
  if (rows.length !== ids.length || rows.some((row) => row.owner_id !== owner.id)) {
    throw new AppError(404, "ticket_not_found", "One of those tickets was not found.");
  }
  if (new Set(rows.map((row) => row.event.id)).size > 1) {
    throw new AppError(400, "mixed_events", "Release tickets for one event at a time.");
  }
  const now = new Date();
  for (const row of rows) {
    if (row.status === "released") continue;
    const blocked = toMyTicket(row, now).release_blocked;
    if (blocked) throw new AppError(409, "release_blocked", `${row.ticket_number}: ${blocked}`);
  }

  const { data: count, error: rpcError } = await db.rpc("release_tickets", {
    p_owner_id: owner.id,
    p_ticket_ids: ids,
  });
  if (rpcError) throw fromRpcError(rpcError.message, "release_tickets failed");

  return { releasedCount: count as number, eventId: rows[0].event.id };
}

/** The holder takes a released seat back before it is resold. Safe to call again. */
export async function takeBackTicket(owner: Profile, ticketId: string): Promise<{ status: "valid" }> {
  const { error } = await supabaseAdmin().rpc("take_back_ticket", {
    p_owner_id: owner.id,
    p_ticket_id: ticketId,
  });
  if (error) throw fromRpcError(error.message, "take_back_ticket failed");
  return { status: "valid" };
}
