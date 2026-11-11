import "server-only";
import { CaptureStatus, CheckoutPaymentIntent, OrderStatus } from "@paypal/paypal-server-sdk";
import { centsToDecimalString, decimalStringToCents } from "@/lib/money";
import { paypalOrders, paypalPayments } from "./client";

export type CreateOrderInput = {
  /** Our own row id. Becomes PayPal's reference_id/custom_id and the idempotency key. */
  referenceId: string;
  totalCents: number;
  description: string;
  intent: "capture" | "authorize";
};

/**
 * Creates a sandbox PayPal order. The amount must be computed on the server
 * from database prices, never taken from the browser or a model.
 */
export async function createPayPalOrder(input: CreateOrderInput): Promise<string> {
  const { result } = await paypalOrders().createOrder({
    body: {
      intent:
        input.intent === "capture" ? CheckoutPaymentIntent.Capture : CheckoutPaymentIntent.Authorize,
      purchaseUnits: [
        {
          referenceId: input.referenceId,
          customId: input.referenceId,
          description: input.description.slice(0, 127),
          amount: { currencyCode: "USD", value: centsToDecimalString(input.totalCents) },
        },
      ],
    },
    // Same row -> same PayPal order on retry.
    paypalRequestId: `create-${input.referenceId}`,
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
  referenceId: string | undefined;
};

/**
 * Captures an approved order and returns it only if PayPal reports a COMPLETED
 * capture. Throws otherwise. The caller must still compare amount, currency and
 * referenceId against its own row before issuing tickets.
 */
export async function capturePayPalOrder(
  paypalOrderId: string,
  referenceId: string,
): Promise<VerifiedCapture> {
  const { result } = await paypalOrders().captureOrder({
    id: paypalOrderId,
    // Idempotent: a retried capture returns the original result instead of charging twice.
    paypalRequestId: `capture-${referenceId}`,
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
    referenceId: capture.customId ?? unit?.customId ?? unit?.referenceId,
  };
}

export type VerifiedRefund = { refundId: string; amountCents: number };

/**
 * Refunds part or all of a capture and returns only if PayPal reports the
 * refund COMPLETED. `requestKey` must be unique per intended refund so a retry
 * cannot refund twice.
 */
export async function refundCapture(
  captureId: string,
  amountCents: number,
  requestKey: string,
  note: string,
): Promise<VerifiedRefund> {
  const { result } = await paypalPayments().refundCapturedPayment({
    captureId,
    paypalRequestId: `refund-${requestKey}`,
    prefer: "return=representation",
    body: {
      amount: { currencyCode: "USD", value: centsToDecimalString(amountCents) },
      noteToPayer: note.slice(0, 255),
    },
  });

  const refunded = decimalStringToCents(result.amount?.value);
  if (!result.id || result.status !== "COMPLETED" || refunded === null) {
    throw new Error(`PayPal refund not completed (status ${result.status ?? "unknown"}).`);
  }
  return { refundId: result.id, amountCents: refunded };
}

export type VerifiedAuthorization = {
  authorizationId: string;
  amountCents: number;
  currency: string;
  referenceId: string | undefined;
};

/**
 * Places the hold for a buyer-approved AUTHORIZE order and returns it only if
 * PayPal reports the authorization CREATED (funds held, nothing charged).
 */
export async function authorizePayPalOrder(
  paypalOrderId: string,
  referenceId: string,
): Promise<VerifiedAuthorization> {
  const { result } = await paypalOrders().authorizeOrder({
    id: paypalOrderId,
    paypalRequestId: `authorize-${referenceId}`,
    prefer: "return=representation",
  });

  const unit = result.purchaseUnits?.[0];
  const authorization = unit?.payments?.authorizations?.[0];
  const amountCents = decimalStringToCents(authorization?.amount?.value);

  if (
    !authorization?.id ||
    authorization.status !== "CREATED" ||
    amountCents === null ||
    !authorization.amount?.currencyCode
  ) {
    throw new Error(
      `PayPal authorization not created (order ${result.status ?? "unknown"}, authorization ${authorization?.status ?? "none"}).`,
    );
  }

  return {
    authorizationId: authorization.id,
    amountCents,
    currency: authorization.amount.currencyCode,
    referenceId: authorization.customId ?? unit?.customId ?? unit?.referenceId,
  };
}

/** Releases a hold. Safe to repeat: PayPal's request id makes the void idempotent. */
export async function voidAuthorization(authorizationId: string, requestKey: string): Promise<void> {
  await paypalPayments().voidPayment({
    authorizationId,
    paypalRequestId: `void-${requestKey}`,
  });
}
