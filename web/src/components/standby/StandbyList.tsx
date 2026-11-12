"use client";

import { useState } from "react";
import Link from "next/link";
import { Hourglass } from "lucide-react";
import { toast } from "sonner";
import { usePersona } from "@/components/shell/PersonaProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEventDay, formatMoment } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { MyStandbyRequest, StandbyStatus } from "@/lib/types";
import { postJson, useApi } from "@/lib/use-api";

const STATUS: Record<StandbyStatus, { label: string; tone: "active" | "good" | "muted" | "bad" }> = {
  draft: { label: "Not confirmed", tone: "muted" },
  authorized: { label: "Waiting", tone: "active" },
  matched: { label: "Seat found, finishing payment", tone: "active" },
  settled: { label: "Seat found", tone: "good" },
  cancelled: { label: "Cancelled, hold released", tone: "muted" },
  expired: { label: "Ended, hold released", tone: "muted" },
  failed: { label: "Failed, not charged", tone: "bad" },
};

const TONE = {
  active: "border-primary/30 bg-primary/10 text-primary",
  good: "border-emerald-300 bg-emerald-50 text-emerald-900",
  muted: "border-border bg-muted text-muted-foreground",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-8 text-center">
      <Hourglass className="mx-auto size-6 text-muted-foreground" aria-hidden />
      <p className="mt-3 font-medium">{title}</p>
      <div className="mt-1 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

/** What the agent understood from the fan's note, and what it will not enforce. */
function ConditionsSummary({ request }: { request: MyStandbyRequest }) {
  const conditions = request.conditions;
  if (!conditions) {
    // Only a request still in the queue can be affected by an unread note.
    if (request.status !== "authorized") return null;
    return (
      <p className="mt-1 text-sm text-muted-foreground">
        The agent has not read this note yet. You will not be matched until it has.
      </p>
    );
  }
  const understood = [
    conditions.same_tier && "all seats in the same ticket type",
    conditions.decide_by && `an answer by ${formatMoment(conditions.decide_by, request.event.timezone)}`,
  ].filter(Boolean);
  return (
    <>
      {understood.length > 0 && (
        <p className="mt-1 text-sm">
          <span className="font-medium">The agent will enforce:</span> {understood.join("; ")}.
        </p>
      )}
      {conditions.unsupported.length > 0 && (
        <p className="mt-1 text-sm text-amber-900">
          Not understood, so not enforced: {conditions.unsupported.map((part) => `“${part}”`).join(", ")}.
        </p>
      )}
      {understood.length === 0 && conditions.unsupported.length === 0 && (
        <p className="mt-1 text-sm text-muted-foreground">The agent found no conditions in this note.</p>
      )}
    </>
  );
}

export function StandbyList() {
  const { status: personaStatus, current } = usePersona();
  const { status, data, error, reload } = useApi<{ requests: MyStandbyRequest[] }>(
    current ? "/api/standby" : null,
    [current?.id],
  );
  const [cancelling, setCancelling] = useState<MyStandbyRequest | null>(null);
  const [working, setWorking] = useState(false);

  if (personaStatus === "ready" && !current) {
    return <Panel title="Choose a demo person">Use the menu at the top right to see that person&apos;s standby requests.</Panel>;
  }
  if (personaStatus !== "ready" || status === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="font-medium">Standby requests could not be loaded</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button className="mt-4" variant="outline" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (data.requests.length === 0) {
    return (
      <Panel title={`${current?.name} is not on standby for anything`}>
        Open a sold-out event from{" "}
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Events
        </Link>{" "}
        and choose Go on standby.
      </Panel>
    );
  }

  async function cancel(request: MyStandbyRequest) {
    setWorking(true);
    try {
      await postJson(`/api/standby/${request.id}/cancel`);
      toast.success(`Standby cancelled. Your ${formatMoney(request.authorized_cents)} hold was released.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel. Please retry.");
    } finally {
      setWorking(false);
      setCancelling(null);
      reload();
    }
  }

  return (
    <>
      <ul className="space-y-3">
        {data.requests.map((request) => {
          const state = STATUS[request.status];
          const active = request.status === "authorized";
          return (
            <li key={request.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/events/${request.event.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {request.event.title}
                    </Link>
                    <Badge variant="outline" className={TONE[state.tone]}>
                      {state.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {request.quantity} seat{request.quantity === 1 ? "" : "s"} ·{" "}
                    {request.tiers.map((t) => `${t.name} ${formatMoney(t.price_cents)}`).join(" or ")} ·{" "}
                    {formatEventDay(request.event.starts_at, request.event.timezone)}
                  </p>
                  {request.conditions_text && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Note to the agent: “{request.conditions_text}”
                    </p>
                  )}
                  {request.conditions_text && (
                    <ConditionsSummary request={request} />
                  )}
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold tabular-nums">
                    {formatMoney(request.captured_cents ?? request.authorized_cents)}
                  </p>
                  <p className="text-muted-foreground">
                    {request.captured_cents !== null ? "charged" : active ? "held by PayPal" : "hold amount"}
                  </p>
                </div>
              </div>
              {request.status === "settled" && (
                <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                  The agent got you {request.quantity === 1 ? "a seat" : `${request.quantity} seats`}.{" "}
                  {request.captured_cents !== null && (
                    <>
                      PayPal charged{" "}
                      <span className="font-medium text-foreground">{formatMoney(request.captured_cents)}</span>
                      {request.captured_cents < request.authorized_cents && " and released the rest of the hold"}
                      {request.capture_id && (
                        <>
                          {" "}
                          (ref <span className="font-mono">{request.capture_id}</span>)
                        </>
                      )}
                      .{" "}
                    </>
                  )}
                  <Link href="/tickets" className="text-primary underline-offset-4 hover:underline">
                    See your ticket{request.quantity === 1 ? "" : "s"}
                  </Link>
                </p>
              )}
              {request.status === "matched" && (
                <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
                  {request.captured_cents !== null
                    ? `PayPal charged ${formatMoney(request.captured_cents)}. Your ticket is issued as soon as the previous holder's refund completes; nothing more is needed from you.`
                    : "A seat was matched to you and PayPal has not confirmed the charge yet. This finishes on its own and you cannot be charged twice."}
                </p>
              )}
              {active && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <p className="text-sm text-muted-foreground">
                    Not charged. Ends {formatMoment(request.expires_at, request.event.timezone)} if no
                    seat is released.
                  </p>
                  <Button variant="outline" onClick={() => setCancelling(request)}>
                    Cancel standby
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={cancelling !== null}
        onOpenChange={(next) => {
          if (!next && !working) setCancelling(null);
        }}
      >
        {cancelling && (
          <DialogContent showCloseButton={!working}>
            <DialogHeader>
              <DialogTitle>Cancel standby?</DialogTitle>
              <DialogDescription>
                You leave the queue for {cancelling.event.title} and PayPal releases your{" "}
                {formatMoney(cancelling.authorized_cents)} hold. You were never charged. If you
                rejoin later you go to the back of the queue.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={working} onClick={() => setCancelling(null)}>
                Stay on standby
              </Button>
              <Button variant="destructive" disabled={working} onClick={() => cancel(cancelling)}>
                {working ? "Releasing hold…" : "Cancel standby"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
