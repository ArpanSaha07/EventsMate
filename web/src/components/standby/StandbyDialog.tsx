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
import { formatEventDay, formatMoment } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { MAX_TICKETS_PER_ORDER, isSoldOut, releaseCutoff } from "@/lib/rules";
import type { StandbyConditions } from "@/lib/conditions";
import type { EventWithTiers } from "@/lib/types";
import { postJson } from "@/lib/use-api";

type Props = {
  event: EventWithTiers;
  /** The sold-out tier whose button was pressed; pre-selected. */
  initialTierId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the hold is in place, so the page can refresh. */
  onAuthorized: () => void;
};

type Phase =
  | { name: "review" }
  | { name: "verifying" }
  | { name: "authorized"; cents: number; result: AuthorizeResult }
  /** A released seat was already waiting, so the agent settled straight away. */
  | { name: "settled"; chargedCents: number }
  /** Matched, but PayPal has not confirmed every step yet. */
  | { name: "matched" };

type AuthorizeResult = {
  status: string;
  authorizedCents: number;
  capturedCents: number | null;
  conditions: StandbyConditions | null;
  expiresAt: string;
};

/** The confirm card for going on standby: exactly what may be charged, then PayPal approval of the hold. */
export function StandbyDialog({ event, initialTierId, open, onOpenChange, onAuthorized }: Props) {
  const { current } = usePersona();
  const soldOut = event.ticket_tiers.filter(isSoldOut);
  const [tierIds, setTierIds] = useState<string[]>([initialTierId]);
  const [quantity, setQuantity] = useState(1);
  const [conditions, setConditions] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "review" });
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);

  const chosen = soldOut.filter((tier) => tierIds.includes(tier.id));
  const holdCents = chosen.length ? quantity * Math.max(...chosen.map((t) => t.price_cents)) : 0;
  const busy = phase.name === "verifying";
  const cutoff = formatMoment(releaseCutoff(event.starts_at), event.timezone);

  function toggleTier(id: string) {
    setTierIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function confirmHold() {
    if (!requestId.current) return;
    setPhase({ name: "verifying" });
    setError(null);
    try {
      const result = await postJson<AuthorizeResult>(`/api/standby/${requestId.current}/authorize`);
      if (result.status === "settled" && result.capturedCents !== null) {
        setPhase({ name: "settled", chargedCents: result.capturedCents });
      } else if (result.status === "matched") {
        setPhase({ name: "matched" });
      } else if (result.status === "authorized") {
        setPhase({ name: "authorized", cents: result.authorizedCents, result });
      } else {
        // A seat was waiting but PayPal refused the charge: the request is closed.
        throw new Error(
          "A seat was available, but PayPal could not charge your hold, so you were not charged and the request was closed. You can try again.",
        );
      }
      onAuthorized();
    } catch (err) {
      setPhase({ name: "review" });
      setError(err instanceof Error ? err.message : "The hold could not be confirmed.");
      requestId.current = null;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return; // never close while the hold is being confirmed
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        {phase.name === "settled" || phase.name === "matched" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CircleCheck className="size-5 text-primary" aria-hidden />
                {phase.name === "settled" ? "You got a seat" : "A seat was found"}
              </DialogTitle>
              <DialogDescription>
                {phase.name === "settled"
                  ? `A released seat was already waiting, so the agent got it for you. PayPal charged ${formatMoney(phase.chargedCents)} and released the rest of the hold. Your ticket is in My tickets.`
                  : "A released seat was already waiting and the agent is finishing the payment with PayPal. Check My standby for the result; your ticket appears in My tickets once it is done."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Link href={phase.name === "settled" ? "/tickets" : "/standby"} className={buttonVariants()}>
                {phase.name === "settled" ? "View my tickets" : "View my standby"}
              </Link>
            </DialogFooter>
          </>
        ) : phase.name === "authorized" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CircleCheck className="size-5 text-primary" aria-hidden />
                You are on standby
              </DialogTitle>
              <DialogDescription>
                PayPal is holding {formatMoney(phase.cents)}. Nothing has been charged. If a seat is
                released before {formatMoment(phase.result.expiresAt, event.timezone)}, the agent gets it
                for you and charges only the ticket price. Otherwise the hold is released.
              </DialogDescription>
            </DialogHeader>
            {conditions.trim() !== "" && (
              <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                {!phase.result.conditions ? (
                  <p>The agent could not read your note yet. You will not be matched until it has.</p>
                ) : (
                  <>
                    <p>
                      <span className="font-medium">From your note, the agent will enforce:</span>{" "}
                      {[
                        phase.result.conditions.same_tier && "all seats in the same ticket type",
                        phase.result.conditions.decide_by &&
                          `an answer by ${formatMoment(phase.result.conditions.decide_by, event.timezone)}`,
                      ]
                        .filter(Boolean)
                        .join("; ") || "nothing"}
                      .
                    </p>
                    {phase.result.conditions.unsupported.length > 0 && (
                      <p className="mt-1 text-amber-900">
                        Not understood, so not enforced:{" "}
                        {phase.result.conditions.unsupported.map((part) => `“${part}”`).join(", ")}. Cancel
                        from My standby if that matters.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
              <Link href="/standby" className={buttonVariants()}>
                View my standby
              </Link>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Go on standby</DialogTitle>
              <DialogDescription>
                {event.title} · {formatEventDay(event.starts_at, event.timezone)}. If a holder
                releases a seat, the agent gets it for you.
              </DialogDescription>
            </DialogHeader>

            <fieldset disabled={busy} className="space-y-4">
              <div>
                <legend className="font-medium">Seats I would accept</legend>
                <ul className="mt-2 space-y-2">
                  {soldOut.map((tier) => (
                    <li key={tier.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2 has-checked:border-primary has-checked:bg-primary/5">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={tierIds.includes(tier.id)}
                          onChange={() => toggleTier(tier.id)}
                        />
                        <span className="flex-1 font-medium">{tier.name}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {formatMoney(tier.price_cents)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">Seats needed</span>
                <div className="flex items-center gap-2" role="group" aria-label="Seats needed">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="One fewer seat"
                    disabled={quantity <= 1}
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
                    aria-label="One more seat"
                    disabled={quantity >= MAX_TICKETS_PER_ORDER}
                    onClick={() => setQuantity((q) => q + 1)}
                  >
                    <Plus aria-hidden />
                  </Button>
                </div>
              </div>

              <div>
                <label htmlFor="standby-conditions" className="font-medium">
                  Anything the agent should know? <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <textarea
                  id="standby-conditions"
                  rows={2}
                  maxLength={300}
                  value={conditions}
                  onChange={(e) => setConditions(e.target.value)}
                  placeholder="For example: only if both seats are in the same tier"
                  className="mt-1.5 w-full resize-none rounded-lg border bg-background px-3 py-2 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
            </fieldset>

            <Separator />

            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">PayPal hold</span>
                <span className="text-lg font-semibold tabular-nums">
                  {chosen.length ? formatMoney(holdCents) : "–"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                A hold, not a charge (sandbox, no real money). You pay only the price of the seats
                the agent actually gets you; the rest of the hold is released. Standby ends {cutoff}
                , and you can cancel any time before a match.
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertTitle>You are not on standby</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {busy ? (
              <p className="py-2 text-center text-muted-foreground" role="status">
                Confirming the hold with PayPal…
              </p>
            ) : !current ? (
              <Alert>
                <AlertTitle>Choose a demo person first</AlertTitle>
                <AlertDescription>Use the menu at the top right to pick who is waiting.</AlertDescription>
              </Alert>
            ) : chosen.length === 0 ? (
              <p className="text-sm text-muted-foreground">Choose at least one ticket type.</p>
            ) : (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">Waiting as {current.name}</p>
                <PayPalCheckout
                  createOrder={async () => {
                    setError(null);
                    const created = await postJson<{ requestId: string; paypalOrderId: string }>(
                      "/api/standby",
                      { eventId: event.id, tierIds, quantity, conditionsText: conditions },
                    );
                    requestId.current = created.requestId;
                    return { orderId: created.paypalOrderId };
                  }}
                  onApprove={confirmHold}
                  onCancel={() => {
                    requestId.current = null;
                    setError("You closed PayPal before approving, so no hold was placed.");
                  }}
                  onError={(err) => {
                    requestId.current = null;
                    setError(err.message || "PayPal could not place the hold. Nothing was held.");
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
