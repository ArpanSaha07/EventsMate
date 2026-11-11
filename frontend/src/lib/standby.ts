import "server-only";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { authorizePayPalOrder, createPayPalOrder, voidAuthorization } from "@/lib/paypal/orders";
import { beforeReleaseCutoff, isSoldOut, releaseCutoff } from "@/lib/rules";
import type { Profile } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MyStandbyRequest } from "@/lib/types";

/** PayPal guarantees an authorization can be captured for this long. */
const HONOR_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

type RequestRow = {
  id: string;
  fan_id: string;
  event_id: string;
  quantity: number;
  status: MyStandbyRequest["status"];
  authorized_cents: number;
  paypal_order_id: string | null;
  authorization_id: string | null;
  expires_at: string;
};

const ROW_COLUMNS =
  "id,fan_id,event_id,quantity,status,authorized_cents,paypal_order_id,authorization_id,expires_at";

async function loadOwnRequest(fan: Profile, requestId: string): Promise<RequestRow> {
  const { data, error } = await supabaseAdmin()
    .from("standby_requests")
    .select(ROW_COLUMNS)
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new Error(`Could not load standby request: ${error.message}`);
  const row = data as RequestRow | null;
  // Same answer for "missing" and "someone else's" so ids cannot be probed.
  if (!row || row.fan_id !== fan.id) {
    throw new AppError(404, "standby_not_found", "Standby request not found.");
  }
  return row;
}

export type CreatedStandby = { requestId: string; paypalOrderId: string; authorizedCents: number };

/**
 * Starts a standby request: validates it against current database state,
 * computes the hold on the server, stores a draft, then creates a PayPal order
 * with intent AUTHORIZE for the fan to approve.
 */
export async function createStandbyRequest(
  fan: Profile,
  input: { eventId: string; tierIds: string[]; quantity: number; conditionsText: string },
): Promise<CreatedStandby> {
  const db = supabaseAdmin();

  const { data: event, error } = await db
    .from("events")
    .select("id,title,status,starts_at,ticket_tiers(id,name,price_cents,capacity,sold_count)")
    .eq("id", input.eventId)
    .maybeSingle();
  if (error) throw new Error(`Could not load event: ${error.message}`);
  if (!event || event.status !== "published") {
    throw new AppError(404, "event_not_found", "That event is no longer available.");
  }
  if (!beforeReleaseCutoff(event.starts_at)) {
    throw new AppError(409, "standby_closed", "Standby for this event has closed.");
  }

  const tierIds = [...new Set(input.tierIds)];
  const tiers = event.ticket_tiers.filter((tier) => tierIds.includes(tier.id));
  if (tiers.length !== tierIds.length) {
    throw new AppError(400, "invalid_tiers", "Choose ticket types from this event.");
  }
  const open = tiers.find((tier) => !isSoldOut(tier));
  if (open) {
    throw new AppError(
      409,
      "tier_available",
      `${open.name} still has seats, so you can buy it now instead of waiting.`,
    );
  }

  const { data: active, error: activeError } = await db
    .from("standby_requests")
    .select("id")
    .eq("fan_id", fan.id)
    .eq("event_id", event.id)
    .eq("status", "authorized")
    .maybeSingle();
  if (activeError) throw new Error(`Could not check existing requests: ${activeError.message}`);
  if (active) {
    throw new AppError(
      409,
      "already_on_standby",
      "You are already on standby for this event. Cancel that request to make a new one.",
    );
  }

  const authorizedCents = input.quantity * Math.max(...tiers.map((tier) => tier.price_cents));

  const { data: request, error: insertError } = await db
    .from("standby_requests")
    .insert({
      fan_id: fan.id,
      event_id: event.id,
      quantity: input.quantity,
      accepted_tier_ids: tierIds,
      conditions_text: input.conditionsText,
      authorized_cents: authorizedCents,
      expires_at: releaseCutoff(event.starts_at).toISOString(),
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`Could not save standby request: ${insertError.message}`);

  const paypalOrderId = await createPayPalOrder({
    referenceId: request.id,
    totalCents: authorizedCents,
    intent: "authorize",
    description: `Standby hold, ${input.quantity} seat${input.quantity === 1 ? "" : "s"}: ${event.title}`,
  });

  const { error: updateError } = await db
    .from("standby_requests")
    .update({ paypal_order_id: paypalOrderId })
    .eq("id", request.id);
  if (updateError) throw new Error(`Could not save PayPal order id: ${updateError.message}`);

  return { requestId: request.id, paypalOrderId, authorizedCents };
}

export type StandbyOutcome = { requestId: string; status: "authorized"; authorizedCents: number };

/**
 * After the fan approved in PayPal: place the hold, verify it against our row,
 * and put the request in the queue. Safe to call again.
 */
export async function authorizeStandbyRequest(fan: Profile, requestId: string): Promise<StandbyOutcome> {
  const db = supabaseAdmin();
  const row = await loadOwnRequest(fan, requestId);

  if (row.status === "authorized") {
    return { requestId: row.id, status: "authorized", authorizedCents: row.authorized_cents };
  }
  if (row.status !== "draft" || !row.paypal_order_id) {
    throw new AppError(409, "standby_not_pending", "This standby request can no longer be confirmed. Please start again.");
  }

  let hold;
  try {
    hold = await authorizePayPalOrder(row.paypal_order_id, row.id);
  } catch (err) {
    console.error("PayPal authorization failed:", err);
    throw new AppError(
      402,
      "authorization_failed",
      "PayPal did not place the hold, so you are not on standby and nothing was held. Please try again.",
    );
  }

  const fail = async (code: string, message: string): Promise<never> => {
    // Never leave money held for a request we are not honouring.
    try {
      await voidAuthorization(hold.authorizationId, row.id);
    } catch (voidError) {
      console.error("Could not void authorization", hold.authorizationId, voidError);
    }
    await db
      .from("standby_requests")
      .update({ status: "failed", authorization_id: hold.authorizationId, closed_at: new Date().toISOString() })
      .eq("id", row.id);
    throw new AppError(409, code, message);
  };

  if (
    hold.amountCents !== row.authorized_cents ||
    hold.currency !== "USD" ||
    hold.referenceId !== row.id
  ) {
    console.error("Authorization does not match request", { requestId: row.id, hold });
    return fail(
      "authorization_mismatch",
      "PayPal's hold did not match this request, so it was released. You are not on standby.",
    );
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return fail("standby_closed", "Standby for this event closed before the hold was placed. The hold was released.");
  }

  const now = new Date();
  const { error } = await db
    .from("standby_requests")
    .update({
      status: "authorized",
      authorization_id: hold.authorizationId,
      authorized_at: now.toISOString(),
      honor_expires_at: new Date(now.getTime() + HONOR_PERIOD_MS).toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "draft");

  if (error) {
    // 23505: the fan already has an active request for this event (double submit).
    if (error.code === "23505") {
      return fail(
        "already_on_standby",
        "You were already on standby for this event, so this second hold was released.",
      );
    }
    console.error("Could not record authorization", row.id, hold.authorizationId, error);
    return fail(
      "standby_not_saved",
      "The hold was placed but could not be recorded, so it was released. Please try again.",
    );
  }

  return { requestId: row.id, status: "authorized", authorizedCents: row.authorized_cents };
}

/** Fan leaves the queue: void the hold, then close the request. Safe to call again. */
export async function cancelStandbyRequest(fan: Profile, requestId: string): Promise<{ status: "cancelled" }> {
  const db = supabaseAdmin();
  const row = await loadOwnRequest(fan, requestId);

  if (row.status === "cancelled") return { status: "cancelled" };
  if (row.status !== "authorized" || !row.authorization_id) {
    throw new AppError(409, "standby_not_active", "This standby request is not active, so there is nothing to cancel.");
  }

  // Claim the row first so the matcher cannot pick it up while we void.
  const { data: claimed, error } = await db
    .from("standby_requests")
    .update({ status: "cancelled", closed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "authorized")
    .select("id");
  if (error) throw new Error(`Could not cancel standby request: ${error.message}`);
  if (!claimed?.length) {
    throw new AppError(409, "standby_just_matched", "This request was just matched to a seat, so it can no longer be cancelled.");
  }

  try {
    await voidAuthorization(row.authorization_id, row.id);
  } catch (err) {
    console.error("Void failed after cancel", row.id, row.authorization_id, err);
    throw new AppError(
      502,
      "void_pending",
      `You are off the standby list, but PayPal has not yet confirmed releasing your ${formatMoney(row.authorized_cents)} hold. It will lapse on its own; no charge can be made.`,
    );
  }
  return { status: "cancelled" };
}

/**
 * Ends requests whose release cutoff has passed and voids their holds.
 * Called before reading a queue, so nobody sees or matches a stale request.
 */
export async function expireDueStandbyRequests(filter: { fanId?: string; eventId?: string } = {}): Promise<void> {
  const db = supabaseAdmin();
  let query = db
    .from("standby_requests")
    .update({ status: "expired", closed_at: new Date().toISOString() })
    .eq("status", "authorized")
    .lte("expires_at", new Date().toISOString());
  if (filter.fanId) query = query.eq("fan_id", filter.fanId);
  if (filter.eventId) query = query.eq("event_id", filter.eventId);

  const { data, error } = await query.select("id,authorization_id");
  if (error) {
    console.error("Could not expire standby requests:", error);
    return;
  }
  for (const row of data ?? []) {
    if (!row.authorization_id) continue;
    try {
      await voidAuthorization(row.authorization_id, row.id);
    } catch (err) {
      // The request is already closed, so it can never be captured; the hold lapses at PayPal.
      console.error("Void failed for expired standby request", row.id, err);
    }
  }
}

/** The fan's requests that matter to them: active first, then recent history. */
export async function listMyStandbyRequests(fan: Profile): Promise<MyStandbyRequest[]> {
  await expireDueStandbyRequests({ fanId: fan.id });

  const { data, error } = await supabaseAdmin()
    .from("standby_requests")
    .select(
      "id,quantity,accepted_tier_ids,conditions_text,status,authorized_cents,authorized_at,expires_at,created_at," +
        "event:events(id,title,venue,city,timezone,starts_at,ends_at,ticket_tiers(id,name,price_cents))",
    )
    .eq("fan_id", fan.id)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Could not load standby requests: ${error.message}`);

  type Row = Omit<MyStandbyRequest, "tiers" | "event"> & {
    accepted_tier_ids: string[];
    event: MyStandbyRequest["event"] & { ticket_tiers: MyStandbyRequest["tiers"] };
  };
  return (data as unknown as Row[])
    .map(({ accepted_tier_ids, event: { ticket_tiers, ...event }, ...rest }) => ({
      ...rest,
      event,
      tiers: ticket_tiers.filter((tier) => accepted_tier_ids.includes(tier.id)),
    }))
    .sort((a, b) => Number(b.status === "authorized") - Number(a.status === "authorized"));
}

/** How many fans are waiting for each event (authorized requests only). */
export async function standbyCountsByEvent(eventIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (eventIds.length === 0) return counts;
  const { data, error } = await supabaseAdmin()
    .from("standby_requests")
    .select("event_id")
    .in("event_id", eventIds)
    .eq("status", "authorized")
    .gt("expires_at", new Date().toISOString());
  if (error) throw new Error(`Could not count standby requests: ${error.message}`);
  for (const row of data ?? []) counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  return counts;
}
