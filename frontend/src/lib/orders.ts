import "server-only";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { capturePayPalOrder, createPayPalOrder, refundCapture } from "@/lib/paypal/orders";
import { maxOrderQuantity, salesOpen, seatsLeft } from "@/lib/rules";
import type { Profile } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

type OrderItem = { tierId: string; tierName: string; quantity: number; unitPriceCents: number };

type OrderRow = {
  id: string;
  buyer_id: string;
  event_id: string;
  items: OrderItem[];
  total_cents: number;
  status: "created" | "paid" | "cancelled" | "failed" | "needs_reconciliation";
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
};

const ORDER_COLUMNS = "id,buyer_id,event_id,items,total_cents,status,paypal_order_id,paypal_capture_id";

export type CreatedOrder = { orderId: string; paypalOrderId: string; totalCents: number };

/**
 * Starts a ticket purchase: validates against current database state, computes
 * the total on the server, stores the order, then creates the PayPal order.
 */
export async function createOrder(
  buyer: Profile,
  input: { tierId: string; quantity: number },
): Promise<CreatedOrder> {
  const db = supabaseAdmin();

  const { data: tier, error } = await db
    .from("ticket_tiers")
    .select("id,name,price_cents,capacity,sold_count,events!inner(id,title,status,starts_at)")
    .eq("id", input.tierId)
    .maybeSingle();
  if (error) throw new Error(`Could not load tier: ${error.message}`);

  const event = tier?.events as unknown as
    | { id: string; title: string; status: string; starts_at: string }
    | undefined;
  if (!tier || !event || event.status !== "published") {
    throw new AppError(404, "tier_not_found", "That ticket type is no longer available.");
  }
  if (!salesOpen(event.starts_at)) {
    throw new AppError(409, "sales_closed", "Ticket sales for this event have closed.");
  }
  const max = maxOrderQuantity(tier);
  if (max === 0) {
    throw new AppError(409, "sold_out", `${tier.name} is sold out. You can go on standby instead.`);
  }
  if (input.quantity > max) {
    throw new AppError(
      409,
      "quantity_unavailable",
      seatsLeft(tier) < input.quantity
        ? `Only ${seatsLeft(tier)} ${tier.name} seat${seatsLeft(tier) === 1 ? "" : "s"} left.`
        : `You can buy up to ${max} tickets per order.`,
    );
  }

  const items: OrderItem[] = [
    { tierId: tier.id, tierName: tier.name, quantity: input.quantity, unitPriceCents: tier.price_cents },
  ];
  const totalCents = tier.price_cents * input.quantity;

  const { data: order, error: insertError } = await db
    .from("orders")
    .insert({ buyer_id: buyer.id, event_id: event.id, items, total_cents: totalCents })
    .select("id")
    .single();
  if (insertError) throw new Error(`Could not save order: ${insertError.message}`);

  const paypalOrderId = await createPayPalOrder({
    referenceId: order.id,
    totalCents,
    intent: "capture",
    description: `${input.quantity} x ${tier.name}: ${event.title}`,
  });

  // Persist the PayPal id before the browser ever sees it.
  const { error: updateError } = await db
    .from("orders")
    .update({ paypal_order_id: paypalOrderId })
    .eq("id", order.id);
  if (updateError) throw new Error(`Could not save PayPal order id: ${updateError.message}`);

  return { orderId: order.id, paypalOrderId, totalCents };
}

export type CaptureOutcome = { orderId: string; status: "paid"; captureId: string; ticketCount: number };

/**
 * Captures the buyer-approved PayPal order, verifies it against our row, and
 * issues tickets in one database transaction. Safe to call again: a paid order
 * returns its existing result and PayPal's request id prevents a second charge.
 */
export async function captureOrder(buyer: Profile, orderId: string): Promise<CaptureOutcome> {
  const db = supabaseAdmin();

  const { data, error } = await db.from("orders").select(ORDER_COLUMNS).eq("id", orderId).maybeSingle();
  if (error) throw new Error(`Could not load order: ${error.message}`);
  const order = data as OrderRow | null;

  // Same answer for "missing" and "someone else's" so ids cannot be probed.
  if (!order || order.buyer_id !== buyer.id) {
    throw new AppError(404, "order_not_found", "Order not found.");
  }
  const ticketCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  if (order.status === "paid" && order.paypal_capture_id) {
    return { orderId: order.id, status: "paid", captureId: order.paypal_capture_id, ticketCount };
  }
  if (order.status !== "created" || !order.paypal_order_id) {
    throw new AppError(409, "order_not_payable", "This order can no longer be paid. Please start again.");
  }

  let capture;
  try {
    capture = await capturePayPalOrder(order.paypal_order_id, order.id);
  } catch (err) {
    console.error("PayPal capture failed:", err);
    throw new AppError(
      402,
      "capture_failed",
      "PayPal did not complete the payment, so no tickets were issued and you were not charged. Please try again.",
    );
  }

  if (
    capture.amountCents !== order.total_cents ||
    capture.currency !== "USD" ||
    capture.referenceId !== order.id
  ) {
    await markForReconciliation(order.id, capture.captureId);
    console.error("Capture does not match order", { orderId: order.id, capture });
    throw new AppError(
      409,
      "capture_mismatch",
      "PayPal took a payment that does not match this order. No tickets were issued; it has been flagged for review.",
    );
  }

  const { error: rpcError } = await db.rpc("fulfil_order", {
    p_order_id: order.id,
    p_capture_id: capture.captureId,
  });

  if (!rpcError) {
    return { orderId: order.id, status: "paid", captureId: capture.captureId, ticketCount };
  }

  // The last seats went to someone else between checkout and payment: give the money back.
  if (rpcError.message.includes("insufficient_inventory")) {
    try {
      await refundCapture(
        capture.captureId,
        capture.amountCents,
        `oversold-${order.id}`,
        "Sold out before your payment completed. Refunded in full.",
      );
      await db
        .from("orders")
        .update({ status: "failed", paypal_capture_id: capture.captureId })
        .eq("id", order.id);
    } catch (refundError) {
      console.error("Refund after oversell failed:", refundError);
      await markForReconciliation(order.id, capture.captureId);
      throw new AppError(
        409,
        "sold_out_refund_pending",
        `These seats sold out while you were paying. Your ${formatMoney(capture.amountCents)} refund could not be completed automatically and has been flagged for review.`,
      );
    }
    throw new AppError(
      409,
      "sold_out_refunded",
      `These seats sold out while you were paying. Your ${formatMoney(capture.amountCents)} payment was refunded in full.`,
    );
  }

  // Paid at PayPal but our write failed: never show success. The order stays
  // payable so a retry re-reads the same capture (PayPal request id) and
  // issues the tickets; the capture id is kept for reconciliation meanwhile.
  console.error("fulfil_order failed after capture:", rpcError);
  const { error: keepError } = await db
    .from("orders")
    .update({ paypal_capture_id: capture.captureId })
    .eq("id", order.id);
  if (keepError) console.error("Could not record capture id:", order.id, capture.captureId, keepError);
  throw new AppError(
    500,
    "fulfilment_pending",
    "PayPal took the payment but your tickets could not be issued yet. You will not be charged again: press retry.",
  );
}

/** Best effort: keep the PayPal reference on the row so the payment can be reconciled. */
async function markForReconciliation(orderId: string, captureId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("orders")
    .update({ status: "needs_reconciliation", paypal_capture_id: captureId })
    .eq("id", orderId)
    .eq("status", "created");
  if (error) console.error("Could not flag order for reconciliation:", orderId, captureId, error);
}
