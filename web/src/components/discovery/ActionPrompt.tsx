"use client";

import { useState } from "react";
import { Check, X, Ticket, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { maxOrderQuantity } from "@/lib/rules";
import type { ActionProposal, PurchaseActionProposal, StandbyActionProposal } from "@/lib/discovery/types";

type ActionPromptProps = {
  proposal: ActionProposal;
  isLoggedIn: boolean;
  onConfirmPurchase: (tierId: string, quantity: number) => void;
  onConfirmStandby: (tierId: string) => void;
  onDecline: () => void;
};

export function ActionPrompt({
  proposal,
  isLoggedIn,
  onConfirmPurchase,
  onConfirmStandby,
  onDecline,
}: ActionPromptProps) {
  const [selectedTierId, setSelectedTierId] = useState<string>(
    proposal.type === "purchase"
      ? proposal.selectedTierId || proposal.availableTiers[0]?.id || ""
      : proposal.selectedTierId || proposal.soldOutTiers[0]?.id || "",
  );
  const [quantity, setQuantity] = useState(1);
  const [loginAlert, setLoginAlert] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If already answered, show status badge
  if (proposal.status === "confirmed") {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
        <Check className="size-3.5" aria-hidden />
        <span>
          {proposal.type === "purchase" ? "Purchase confirmed" : "Standby request confirmed"}
        </span>
      </div>
    );
  }

  if (proposal.status === "declined") {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border bg-muted/60 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <X className="size-3.5" aria-hidden />
        <span>Declined</span>
      </div>
    );
  }

  if (proposal.type === "purchase") {
    const purchaseProp = proposal as PurchaseActionProposal;
    const currentTier =
      purchaseProp.availableTiers.find((t) => t.id === selectedTierId) ??
      purchaseProp.availableTiers[0];
    const maxQty = currentTier ? maxOrderQuantity(currentTier) : 4;

    const handleYes = () => {
      if (isSubmitting) return;
      if (!isLoggedIn) {
        setLoginAlert(true);
        return;
      }
      setIsSubmitting(true);
      onConfirmPurchase(selectedTierId, quantity);
    };

    const handleNo = () => {
      if (isSubmitting) return;
      setIsSubmitting(true);
      onDecline();
    };

    return (
      <div className="mt-3 rounded-xl border bg-card/80 p-3.5 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <Ticket className="size-4 text-primary" aria-hidden />
          <span>{proposal.promptText}</span>
        </div>

        {/* Tier & Quantity Selector if multiple tiers or options */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {purchaseProp.availableTiers.length > 1 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Tier:</span>
              <select
                value={selectedTierId}
                disabled={isSubmitting}
                onChange={(e) => {
                  setSelectedTierId(e.target.value);
                  setQuantity(1);
                }}
                className="rounded-md border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {purchaseProp.availableTiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({formatMoney(t.price_cents)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {currentTier && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Price:</span>
              <span className="font-semibold text-foreground">
                {formatMoney(currentTier.price_cents * quantity)}
              </span>
            </div>
          )}

          {maxQty > 1 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Qty:</span>
              <div className="inline-flex items-center rounded-md border bg-background">
                <button
                  type="button"
                  disabled={quantity <= 1 || isSubmitting}
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  -
                </button>
                <span className="px-2 font-mono text-xs">{quantity}</span>
                <button
                  type="button"
                  disabled={quantity >= maxQty || isSubmitting}
                  onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                  className="px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>

        {loginAlert && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            <span>Please choose a demo person (top right) to continue with purchase.</span>
          </div>
        )}

        {/* Yes / No Buttons */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            disabled={isSubmitting}
            onClick={handleYes}
            className="h-7 text-xs px-3 gap-1"
          >
            <Check className="size-3" aria-hidden />
            Yes, purchase
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isSubmitting}
            onClick={handleNo}
            className="h-7 text-xs px-3 gap-1"
          >
            <X className="size-3" aria-hidden />
            No
          </Button>
        </div>
      </div>
    );
  }

  // Standby Proposal
  const standbyProp = proposal as StandbyActionProposal;
  const currentSoldOutTier =
    standbyProp.soldOutTiers.find((t) => t.id === selectedTierId) ??
    standbyProp.soldOutTiers[0];

  const handleYes = () => {
    if (isSubmitting) return;
    if (!isLoggedIn) {
      setLoginAlert(true);
      return;
    }
    setIsSubmitting(true);
    onConfirmStandby(selectedTierId);
  };

  const handleNo = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    onDecline();
  };

  return (
    <div className="mt-3 rounded-xl border bg-card/80 p-3.5 shadow-xs space-y-3">
      <div className="flex items-start gap-2 text-xs font-medium text-foreground">
        <Clock className="size-4 shrink-0 text-amber-500 mt-0.5" aria-hidden />
        <span>{proposal.promptText}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {standbyProp.soldOutTiers.length > 1 && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Tier:</span>
            <select
              value={selectedTierId}
              disabled={isSubmitting}
              onChange={(e) => setSelectedTierId(e.target.value)}
              className="rounded-md border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {standbyProp.soldOutTiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({formatMoney(t.price_cents)})
                </option>
              ))}
            </select>
          </div>
        )}

        {currentSoldOutTier && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Hold amount:</span>
            <span className="font-semibold text-foreground">
              {formatMoney(currentSoldOutTier.price_cents)}
            </span>
            <span className="text-muted-foreground">(authorized, not charged)</span>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        A PayPal hold is placed with no upfront charge. The ticket is issued automatically if a
        seat frees up.
      </p>

      {loginAlert && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>Please choose a demo person (top right) to join standby.</span>
        </div>
      )}

      {/* Yes / No Buttons */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          disabled={isSubmitting}
          onClick={handleYes}
          className="h-7 text-xs px-3 gap-1"
        >
          <Check className="size-3" aria-hidden />
          Yes, join standby
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isSubmitting}
          onClick={handleNo}
          className="h-7 text-xs px-3 gap-1"
        >
          <X className="size-3" aria-hidden />
          No
        </Button>
      </div>
    </div>
  );
}
