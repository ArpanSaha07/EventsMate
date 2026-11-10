import "server-only";
import { CaptureStatus, CheckoutPaymentIntent, OrderStatus } from "@paypal/paypal-server-sdk";
import { centsToDecimalString, decimalStringToCents } from "@/lib/money";
import { paypalOrders } from "./client";

export type CreateOrderInput = {
  checkoutId: string;
  totalCents: number;
  currency: "CAD";
  description: string;
};

/**
 * Creates a sandbox PayPal order. The amount must come from the approved checkout
 * snapshot in Supabase, never from the browser or the model.
 */
export async function createPayPalOrder(input: CreateOrderInput): Promise<string> {
  const { result } = await paypalOrders().createOrder({
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          referenceId: input.checkoutId,
          customId: input.checkoutId,
          description: input.description.slice(0, 127),
          amount: {
            currencyCode: input.currency,
            value: centsToDecimalString(input.totalCents),
          },
        },
      ],
    },
    // Same checkout -> same PayPal order on retry.
    paypalRequestId: `create-${input.checkoutId}`,
    prefer: "return=representation",
  });

  if (!result.id) throw new Error("PayPal did not return an order ID.");
  return result.id;
}

export type VerifiedCapture = {
  paypalOrderId: string;
  captureId: string;
  amountCents: number;
  currency: string;
  checkoutId: string | undefined;
};

/**
 * Captures an approved order and returns it only if PayPal reports a COMPLETED
 * capture. Throws otherwise. The caller must still compare amount, currency and
 * checkoutId against the approved snapshot before issuing tickets.
 */
export async function capturePayPalOrder(
  paypalOrderId: string,
  checkoutId: string,
): Promise<VerifiedCapture> {
  const { result } = await paypalOrders().captureOrder({
    id: paypalOrderId,
    // Idempotent: a retried capture returns the original result instead of charging twice.
    paypalRequestId: `capture-${checkoutId}`,
    prefer: "return=representation",
  });

  const unit = result.purchaseUnits?.[0];
  const capture = unit?.payments?.captures?.[0];
  const amountCents = decimalStringToCents(capture?.amount?.value);

  if (
    result.status !== OrderStatus.Completed ||
    !capture?.id ||
    capture.status !== CaptureStatus.Completed ||
    amountCents === null ||
    !capture.amount?.currencyCode
  ) {
    throw new Error(
      `PayPal capture not completed (order ${result.status ?? "unknown"}, capture ${capture?.status ?? "none"}).`,
    );
  }

  return {
    paypalOrderId,
    captureId: capture.id,
    amountCents,
    currency: capture.amount.currencyCode,
    checkoutId: capture.customId ?? unit?.customId ?? unit?.referenceId,
  };
}
