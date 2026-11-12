"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, Minus, Plus, TriangleAlert } from "lucide-react";
import { PayPalCheckout } from "@/components/checkout/PayPalCheckout";
import { usePersona } from "@/components/shell/PersonaProvider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { formatEventDay, formatEventTimeRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { maxOrderQuantity } from "@/lib/rules";
import type { EventWithTiers, Tier } from "@/lib/types";
import { ApiRequestError, postJson } from "@/lib/use-api";

type Props = {
  event: EventWithTiers;
  tier: Tier;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after tickets were issued, so the page can refresh availability. */
  onPaid: () => void;
};

type Phase =
  | { name: "review" }
  | { name: "verifying" }
  | { name: "paid"; ticketCount: number; captureId: string }
  | { name: "retry"; message: string };

/** The confirm card for buying tickets: exact items and total, then PayPal approval. */
export function BuyDialog({ event, tier, open, onOpenChange, onPaid }: Props) {
  const { current } = usePersona();
  const max = maxOrderQuantity(tier);
  const [quantity, setQuantity] = useState(1);
  const [phase, setPhase] = useState<Phase>({ name: "review" });
  const [error, setError] = useState<string | null>(null);
  const orderId = useRef<string | null>(null);

  const total = tier.price_cents * quantity;
  const busy = phase.name === "verifying";

  function reset() {
    setQuantity(1);
    setPhase({ name: "review" });
    setError(null);
    orderId.current = null;
  }

  async function capture() {
    if (!orderId.current) return;
    setPhase({ name: "verifying" });
    setError(null);
    try {
      const result = await postJson<{ ticketCount: number; captureId: string }>(
        `/api/orders/${orderId.current}/capture`,
      );
      setPhase({ name: "paid", ticketCount: result.ticketCount, captureId: result.captureId });
      onPaid();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payment could not be verified.";
      // Only "paid but tickets not issued yet" is worth retrying with the same order.
      if (err instanceof ApiRequestError && err.code === "fulfilment_pending") {
        setPhase({ name: "retry", message });
      }
      else {
        setPhase({ name: "review" });
        setError(message);
        orderId.current = null;
        onPaid(); // availability may have changed (for example, sold out)
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return; // never close while money is being verified
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        {phase.name === "paid" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CircleCheck className="size-5 text-primary" aria-hidden />
                Payment verified
              </DialogTitle>
              <DialogDescription>
                {phase.ticketCount} {tier.name} ticket{phase.ticketCount === 1 ? "" : "s"} for{" "}
                {event.title} {phase.ticketCount === 1 ? "is" : "are"} now yours.
              </DialogDescription>
            </DialogHeader>
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              PayPal capture <span className="font-mono text-foreground">{phase.captureId}</span>{" "}
              (sandbox)
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Link href="/tickets" className={buttonVariants()}>
                View my tickets
              </Link>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Buy tickets</DialogTitle>
              <DialogDescription>
                {event.title} · {formatEventDay(event.starts_at, event.timezone)},{" "}
                {formatEventTimeRange(event.starts_at, event.ends_at, event.timezone)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">{tier.name}</p>
                  <p className="text-muted-foreground">{formatMoney(tier.price_cents)} each</p>
                </div>
                <div className="flex items-center gap-2" role="group" aria-label="Quantity">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="One fewer ticket"
                    disabled={quantity <= 1 || busy || phase.name === "retry"}
                    onClick={() => setQuantity((q) => q - 1)}
                  >
                    <Minus aria-hidden />
                  </Button>
                  <span className="w-6 text-center font-medium tabular-nums" aria-live="polite">
                    {quantity}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="One more ticket"
                    disabled={quantity >= max || busy || phase.name === "retry"}
                    onClick={() => setQuantity((q) => q + 1)}
                  >
                    <Plus aria-hidden />
                  </Button>
                </div>
              </div>

              <Separator />

              <div className="flex items-baseline justify-between">
                <span className="font-medium">Total</span>
                <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                You approve this exact amount in PayPal (sandbox, no real money). Tickets are issued
                only after PayPal confirms the payment.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertTitle>No tickets were issued</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {phase.name === "retry" ? (
              <div className="space-y-3">
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>Tickets not issued yet</AlertTitle>
                  <AlertDescription>{phase.message}</AlertDescription>
                </Alert>
                <Button className="w-full" onClick={capture}>
                  Retry issuing tickets
                </Button>
              </div>
            ) : busy ? (
              <p className="py-2 text-center text-muted-foreground" role="status">
                Verifying your payment with PayPal…
              </p>
            ) : !current ? (
              <Alert>
                <AlertTitle>Choose a demo person first</AlertTitle>
                <AlertDescription>
                  Use the menu at the top right to pick who is buying.
                </AlertDescription>
              </Alert>
            ) : (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">Buying as {current.name}</p>
                <PayPalCheckout
                  createOrder={async () => {
                    setError(null);
                    const created = await postJson<{ orderId: string; paypalOrderId: string }>(
                      "/api/orders",
                      { tierId: tier.id, quantity },
                    );
                    orderId.current = created.orderId;
                    return { orderId: created.paypalOrderId };
                  }}
                  onApprove={capture}
                  onCancel={() => {
                    orderId.current = null;
                    setError("You closed PayPal before approving, so you were not charged.");
                  }}
                  onError={(err) => {
                    orderId.current = null;
                    setError(err.message || "PayPal checkout failed. You were not charged.");
                  }}
                />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
