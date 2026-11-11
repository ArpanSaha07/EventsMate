import { describe, expect, it } from "vitest";
import {
  settleRequest,
  type CaptureResult,
  type SettlementDeps,
  type SettlementItem,
  type SettlementState,
} from "@/lib/settlement-flow";

const REQUEST = "req-1";

function item(id: string, over: Partial<SettlementItem> = {}): SettlementItem {
  return {
    id,
    status: "pending",
    ticketNumber: `EM-${id}`,
    priceCents: 2500,
    refundCents: 2250,
    holderCaptureId: `holder-capture-${id}`,
    refundId: null,
    ...over,
  };
}

/** An in-memory stand-in for the database functions and PayPal, recording every call. */
function harness(options: {
  items?: SettlementItem[];
  requestStatus?: string;
  capture?: (amountCents: number) => CaptureResult;
  refund?: (key: string, amountCents: number) => { refundId: string; amountCents: number };
  completeFails?: boolean;
}) {
  const state: SettlementState = {
    requestId: REQUEST,
    requestStatus: options.requestStatus ?? "matched",
    authorizationId: "auth-1",
    eventTitle: "Hack Night",
    items: options.items ?? [item("s1")],
  };
  const calls: string[] = [];
  const find = (id: string) => state.items.find((i) => i.id === id)!;

  const deps: SettlementDeps = {
    log: () => {},
    paypal: {
      async capture(authorizationId, amountCents, key) {
        calls.push(`capture ${authorizationId} ${amountCents} key=${key}`);
        return (
          options.capture?.(amountCents) ?? {
            outcome: "completed",
            captureId: "cap-1",
            amountCents,
            currency: "USD",
          }
        );
      },
      async refund(captureId, amountCents, key) {
        calls.push(`refund ${captureId} ${amountCents} key=${key}`);
        return options.refund?.(key, amountCents) ?? { refundId: `ref-${key}`, amountCents };
      },
      async voidHold(authorizationId) {
        calls.push(`void ${authorizationId}`);
      },
    },
    store: {
      async load() {
        return structuredClone(state);
      },
      async recordCapture(_requestId, captureId, amountCents) {
        calls.push(`recordCapture ${captureId} ${amountCents}`);
        for (const i of state.items) if (i.status === "pending") i.status = "captured";
      },
      async failCapture(_requestId, reason) {
        calls.push(`failCapture ${reason}`);
        for (const i of state.items) if (i.status === "pending") i.status = "capture_failed";
        state.requestStatus = "failed";
      },
      async recordRefundFailure(settlementId) {
        calls.push(`refundFailure ${settlementId}`);
        find(settlementId).status = "refund_failed";
      },
      async complete(settlementId, refundId, refundCents) {
        calls.push(`complete ${settlementId} ${refundId} ${refundCents}`);
        if (options.completeFails) throw new Error("database unavailable");
        Object.assign(find(settlementId), { status: "transferred", refundId });
        if (state.items.every((i) => i.status === "transferred")) state.requestStatus = "settled";
      },
      async markRefunded(settlementId, refundId) {
        calls.push(`markRefunded ${settlementId} ${refundId}`);
        Object.assign(find(settlementId), { status: "refunded", refundId });
      },
    },
  };
  return { deps, state, calls, options };
}

describe("settleRequest", () => {
  it("captures the fan, then refunds the holder, then transfers, in that order (D10)", async () => {
    const h = harness({});
    expect(await settleRequest(h.deps, REQUEST)).toBe("settled");
    expect(h.calls).toEqual([
      "capture auth-1 2500 key=req-1",
      "recordCapture cap-1 2500",
      "refund holder-capture-s1 2250 key=s1",
      "complete s1 ref-s1 2250",
    ]);
    expect(h.state.requestStatus).toBe("settled");
  });

  it("captures once for all seats of a request and refunds each holder separately", async () => {
    const h = harness({ items: [item("s1"), item("s2", { priceCents: 6000, refundCents: 6000 })] });
    expect(await settleRequest(h.deps, REQUEST)).toBe("settled");
    expect(h.calls.filter((c) => c.startsWith("capture"))).toEqual(["capture auth-1 8500 key=req-1"]);
    expect(h.calls.filter((c) => c.startsWith("refund "))).toEqual([
      "refund holder-capture-s1 2250 key=s1",
      "refund holder-capture-s2 6000 key=s2",
    ]);
  });

  it("does nothing on a repeat: no second charge, refund or ticket", async () => {
    const h = harness({});
    await settleRequest(h.deps, REQUEST);
    const before = h.calls.length;
    expect(await settleRequest(h.deps, REQUEST)).toBe("settled");
    expect(h.calls).toHaveLength(before);
  });

  it("ignores a request that is not in a settlement", async () => {
    const h = harness({ requestStatus: "authorized" });
    expect(await settleRequest(h.deps, REQUEST)).toBe("not_matched");
    expect(h.calls).toEqual([]);
  });

  it("a refused capture refunds nobody and leaves the tickets untransferred", async () => {
    const h = harness({ capture: () => ({ outcome: "failed", reason: "AUTHORIZATION_VOIDED" }) });
    expect(await settleRequest(h.deps, REQUEST)).toBe("capture_failed");
    expect(h.calls).toEqual([
      "capture auth-1 2500 key=req-1",
      "failCapture AUTHORIZATION_VOIDED",
      "void auth-1",
    ]);
    expect(h.calls.some((c) => c.startsWith("refund ") || c.startsWith("complete"))).toBe(false);
  });

  it("an unconfirmed capture changes nothing, and the retry reuses the same PayPal key", async () => {
    let attempts = 0;
    const h = harness({
      capture: (amountCents) =>
        ++attempts === 1
          ? { outcome: "unknown", reason: "timeout" }
          : { outcome: "completed", captureId: "cap-1", amountCents, currency: "USD" },
    });
    expect(await settleRequest(h.deps, REQUEST)).toBe("capture_unconfirmed");
    expect(h.calls).toEqual(["capture auth-1 2500 key=req-1"]);
    expect(h.state.items[0].status).toBe("pending");

    expect(await settleRequest(h.deps, REQUEST)).toBe("settled");
    expect(h.calls.filter((c) => c.startsWith("capture"))).toEqual([
      "capture auth-1 2500 key=req-1",
      "capture auth-1 2500 key=req-1",
    ]);
  });

  it("a capture for a different amount is never recorded or refunded against", async () => {
    const h = harness({
      capture: () => ({ outcome: "completed", captureId: "cap-1", amountCents: 9999, currency: "USD" }),
    });
    expect(await settleRequest(h.deps, REQUEST)).toBe("capture_unconfirmed");
    expect(h.calls).toEqual(["capture auth-1 2500 key=req-1"]);
  });

  it("a failed refund holds the transfer; the retry does not capture again (D52)", async () => {
    let refuse = true;
    const h = harness({
      refund: (key, amountCents) => {
        if (refuse) throw new Error("PayPal refund not completed (status PENDING).");
        return { refundId: `ref-${key}`, amountCents };
      },
    });
    expect(await settleRequest(h.deps, REQUEST)).toBe("refund_pending");
    expect(h.state.items[0].status).toBe("refund_failed");
    expect(h.calls.some((c) => c.startsWith("complete"))).toBe(false);

    refuse = false;
    h.calls.length = 0;
    expect(await settleRequest(h.deps, REQUEST)).toBe("settled");
    expect(h.calls).toEqual(["refund holder-capture-s1 2250 key=s1", "complete s1 ref-s1 2250"]);
  });

  it("with two seats, one failed refund does not block the other seat's transfer", async () => {
    const h = harness({
      items: [item("s1"), item("s2")],
      refund: (key, amountCents) => {
        if (key === "s1") throw new Error("refused");
        return { refundId: `ref-${key}`, amountCents };
      },
    });
    expect(await settleRequest(h.deps, REQUEST)).toBe("refund_pending");
    expect(h.state.items.map((i) => i.status)).toEqual(["refund_failed", "transferred"]);
    expect(h.state.requestStatus).toBe("matched");
  });

  it("a refund for the wrong amount does not transfer the ticket", async () => {
    const h = harness({ refund: (key) => ({ refundId: `ref-${key}`, amountCents: 1 }) });
    expect(await settleRequest(h.deps, REQUEST)).toBe("refund_pending");
    expect(h.calls.some((c) => c.startsWith("complete"))).toBe(false);
  });

  it("keeps the refund id when the transfer write fails, and the retry does not refund again", async () => {
    const h = harness({ completeFails: true });
    expect(await settleRequest(h.deps, REQUEST)).toBe("refund_pending");
    expect(h.state.items[0]).toMatchObject({ status: "refunded", refundId: "ref-s1" });

    h.options.completeFails = false;
    h.calls.length = 0;
    expect(await settleRequest(h.deps, REQUEST)).toBe("settled");
    expect(h.calls).toEqual(["complete s1 ref-s1 2250"]);
  });

  it("a ticket with no PayPal payment behind it is not refunded or transferred", async () => {
    const h = harness({ items: [item("s1", { status: "captured", holderCaptureId: null })] });
    expect(await settleRequest(h.deps, REQUEST)).toBe("refund_pending");
    expect(h.calls).toEqual(["refundFailure s1"]);
  });
});
