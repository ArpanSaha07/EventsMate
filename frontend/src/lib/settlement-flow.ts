/**
 * The settlement steps for one matched standby request (F5), in the order
 * D10 and D52 require: capture the fan's hold, refund each holder, transfer
 * each ticket. Driven entirely by stored state, so it can be run again after
 * a crash or a failed step without charging, refunding or issuing twice.
 *
 * PayPal and the database are passed in so the order of operations is unit-tested.
 */

export type CaptureResult =
  | { outcome: "completed"; captureId: string; amountCents: number; currency: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "unknown"; reason: string };

export type SettlementItemStatus =
  | "pending"
  | "captured"
  | "refund_failed"
  | "refunded"
  | "transferred"
  | "capture_failed";

export type SettlementItem = {
  id: string;
  status: SettlementItemStatus;
  ticketNumber: string;
  /** What the fan pays for this seat. */
  priceCents: number;
  /** What the holder gets back. */
  refundCents: number;
  /** The holder's original PayPal capture, which the refund is issued against. */
  holderCaptureId: string | null;
  refundId: string | null;
};

export type SettlementState = {
  requestId: string;
  requestStatus: string;
  authorizationId: string | null;
  eventTitle: string;
  items: SettlementItem[];
};

export type SettlementDeps = {
  paypal: {
    /** Final capture of part of a hold. Must be idempotent on `key`. */
    capture(authorizationId: string, amountCents: number, key: string, note: string): Promise<CaptureResult>;
    /** Partial refund of a capture. Resolves only for a COMPLETED refund; idempotent on `key`. */
    refund(
      captureId: string,
      amountCents: number,
      key: string,
      note: string,
    ): Promise<{ refundId: string; amountCents: number }>;
    voidHold(authorizationId: string, key: string): Promise<void>;
  };
  store: {
    load(requestId: string): Promise<SettlementState | null>;
    recordCapture(requestId: string, captureId: string, amountCents: number): Promise<void>;
    failCapture(requestId: string, reason: string): Promise<void>;
    recordRefundFailure(settlementId: string, reason: string): Promise<void>;
    /** Records the refund and transfers the ticket in one transaction. */
    complete(settlementId: string, refundId: string, refundCents: number): Promise<void>;
    /** Fallback when `complete` fails after PayPal refunded: keep the refund id for the retry. */
    markRefunded(settlementId: string, refundId: string): Promise<void>;
  };
  log?: (message: string, detail?: unknown) => void;
};

export type SettleOutcome =
  /** Every seat is paid for, refunded and transferred. */
  | "settled"
  /** PayPal refused the capture: nobody charged, nobody refunded, seats still released. */
  | "capture_failed"
  /** No definite answer from PayPal about the capture; nothing else was done. */
  | "capture_unconfirmed"
  /** The fan is charged; at least one refund or transfer is still owed and will be retried. */
  | "refund_pending"
  /** The request is not in a settlement. */
  | "not_matched";

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : "unknown error";
}

export async function settleRequest(deps: SettlementDeps, requestId: string): Promise<SettleOutcome> {
  const { paypal, store } = deps;
  const log = deps.log ?? ((message, detail) => console.error(message, detail));

  let state = await store.load(requestId);
  if (!state) return "not_matched";
  if (state.requestStatus === "settled") return "settled";
  if (state.requestStatus !== "matched") return "not_matched";

  const pending = state.items.filter((item) => item.status === "pending");
  if (pending.length > 0) {
    const total = pending.reduce((sum, item) => sum + item.priceCents, 0);
    if (!state.authorizationId) {
      await store.failCapture(requestId, "no PayPal hold on the request");
      return "capture_failed";
    }

    const capture = await paypal.capture(
      state.authorizationId,
      total,
      requestId,
      `Standby seat${pending.length === 1 ? "" : "s"} for ${state.eventTitle}`,
    );
    if (capture.outcome === "failed") {
      await store.failCapture(requestId, capture.reason);
      // The request is closed, so the rest of the hold should not stay on the fan's account.
      try {
        await paypal.voidHold(state.authorizationId, requestId);
      } catch (err) {
        log("Void after failed capture did not complete; the hold lapses at PayPal.", { requestId, err });
      }
      return "capture_failed";
    }
    if (capture.outcome === "unknown") {
      log("Capture not confirmed; will retry with the same key.", { requestId, reason: capture.reason });
      return "capture_unconfirmed";
    }
    if (capture.amountCents !== total || capture.currency !== "USD") {
      // Never refund a holder against a capture that is not exactly what we asked for.
      log("Capture does not match the settlement; flagged for review.", { requestId, capture, total });
      return "capture_unconfirmed";
    }
    await store.recordCapture(requestId, capture.captureId, total);

    state = await store.load(requestId);
    if (!state) return "not_matched";
  }

  let owed = false;
  for (const item of state.items) {
    if (item.status === "transferred" || item.status === "capture_failed") continue;
    if (item.status === "pending") {
      owed = true;
      continue;
    }

    let refundId = item.status === "refunded" ? item.refundId : null;
    if (!refundId) {
      try {
        if (!item.holderCaptureId) throw new Error("the holder's ticket has no PayPal payment");
        const refund = await paypal.refund(
          item.holderCaptureId,
          item.refundCents,
          item.id,
          `Your seat ${item.ticketNumber} for ${state.eventTitle} was resold.`,
        );
        if (refund.amountCents !== item.refundCents) {
          throw new Error(`PayPal refunded ${refund.amountCents} cents, expected ${item.refundCents}`);
        }
        refundId = refund.refundId;
      } catch (err) {
        log("Holder refund failed; ticket not transferred.", { settlementId: item.id, err });
        await store.recordRefundFailure(item.id, reasonOf(err));
        owed = true;
        continue;
      }
    }

    try {
      await store.complete(item.id, refundId, item.refundCents);
    } catch (err) {
      log("Refund completed at PayPal but the transfer was not written.", { settlementId: item.id, refundId, err });
      try {
        await store.markRefunded(item.id, refundId);
      } catch (markError) {
        log("Could not keep the refund id for reconciliation.", { settlementId: item.id, refundId, markError });
      }
      owed = true;
    }
  }
  return owed ? "refund_pending" : "settled";
}
