"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoment } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { MyTicket } from "@/lib/types";
import { postJson } from "@/lib/use-api";

/**
 * The confirm card for releasing seats (D18, D45). `tickets` are the holder's
 * releasable tickets for one event; `initialId` is the one they clicked.
 * Every amount shown was computed by the server.
 */
export function ReleaseDialog({
  tickets,
  initialId,
  onClose,
  onReleased,
}: {
  tickets: MyTicket[];
  initialId: string;
  onClose: () => void;
  onReleased: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set([initialId]));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const event = tickets[0].event;
  const chosen = tickets.filter((ticket) => selected.has(ticket.id));
  const total = chosen.reduce((sum, ticket) => sum + (ticket.refund?.refund_cents ?? 0), 0);
  const changes = chosen.filter((ticket) => ticket.refund?.next);
  const cutoff = formatMoment(tickets[0].release_cutoff_at, event.timezone);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function release() {
    setWorking(true);
    setError(null);
    try {
      await postJson("/api/tickets/release", { ticketIds: chosen.map((ticket) => ticket.id) });
      toast.success(
        chosen.length === 1
          ? "Seat released. It stays yours until someone on standby takes it."
          : `${chosen.length} seats released. They stay yours until someone on standby takes them.`,
      );
      onReleased();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release. Please retry.");
      // The list may be out of date (for example the cutoff just passed).
      onReleased();
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !working) onClose();
      }}
    >
      <DialogContent showCloseButton={!working}>
        <DialogHeader>
          <DialogTitle>Release {chosen.length > 1 ? `${chosen.length} seats` : "your seat"}?</DialogTitle>
          <DialogDescription>
            {event.title}. The agent offers a released seat to fans on standby. You are refunded
            only when it is resold.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-lg border">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <label className="flex cursor-pointer items-start gap-3 p-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={selected.has(ticket.id)}
                  disabled={working}
                  onChange={() => toggle(ticket.id)}
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium">
                      {ticket.tier.name} <span className="font-mono font-normal">{ticket.ticket_number}</span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatMoney(ticket.refund?.refund_cents ?? 0)} back
                    </span>
                  </span>
                  {ticket.refund && (
                    <span className="mt-0.5 block text-muted-foreground">
                      {ticket.refund.terms} (you paid {formatMoney(ticket.unit_price_cents)}). Policy: “
                      {ticket.refund.quote}”
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="rounded-lg bg-muted px-3 py-2 text-sm">
          <p className="flex items-baseline justify-between gap-3">
            <span>If resold now, you get back</span>
            <span className="text-base font-semibold tabular-nums">{formatMoney(total)}</span>
          </p>
          {changes.map((ticket) => (
            <p key={ticket.id} className="mt-1 text-amber-900">
              {tickets.length > 1 && `${ticket.ticket_number}: `}
              {formatMoney(ticket.refund!.next!.refund_cents)} instead if it is resold after{" "}
              {formatMoment(ticket.refund!.next!.at, event.timezone)} ({ticket.refund!.next!.terms.toLowerCase()}).
            </p>
          ))}
        </div>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>The ticket stays yours and valid for entry until it is resold.</li>
          <li>You can take it back any time before that.</li>
          <li>
            If nobody takes it by {cutoff}, it returns to you and there is no refund.
          </li>
        </ul>

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={working} onClick={onClose}>
            Keep {tickets.length > 1 ? "my seats" : "my seat"}
          </Button>
          <Button disabled={working || chosen.length === 0} onClick={release}>
            {working ? "Releasing…" : chosen.length > 1 ? `Release ${chosen.length} seats` : "Release seat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
