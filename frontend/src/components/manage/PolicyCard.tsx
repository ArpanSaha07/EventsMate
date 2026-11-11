"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { RefundExamples, RuleClauses } from "@/components/manage/RuleSummary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEventDay, formatMoment } from "@/lib/dates";
import { MAX_POLICY_LENGTH } from "@/lib/refund-rule";
import type { ManagedEvent, PolicyReadingResult } from "@/lib/types";
import { postJson } from "@/lib/use-api";

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** One event's refund policy: write it, have it read, check the reading, confirm. */
export function PolicyCard({ event, onConfirmed }: { event: ManagedEvent; onConfirmed: (event: ManagedEvent) => void }) {
  const [text, setText] = useState(event.refund_policy_text);
  const [reading, setReading] = useState<PolicyReadingResult | null>(null);
  const [busy, setBusy] = useState<"reading" | "confirming" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Examples are computed for the moment the card was opened; stable across re-renders.
  const [now] = useState(() => new Date());

  const trimmed = squash(text);
  const tooShort = trimmed.length < 10;
  // A reading only counts for the exact text it was made from.
  const current = reading && squash(reading.policy_text) === trimmed ? reading : null;
  const unchanged = trimmed === squash(event.refund_policy_text);
  const confirmed = event.refund_rule !== null;

  async function read() {
    setBusy("reading");
    setError(null);
    try {
      const res = await postJson<{ reading: PolicyReadingResult }>(
        `/api/manage/events/${event.id}/policy/read`,
        { policyText: trimmed },
      );
      setReading(res.reading);
    } catch (err) {
      setReading(null);
      setError(err instanceof Error ? err.message : "The policy could not be read. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  async function confirm(readingId: string) {
    setBusy("confirming");
    setError(null);
    try {
      const res = await postJson<{ event: ManagedEvent }>(
        `/api/manage/events/${event.id}/policy/confirm`,
        { readingId },
      );
      setReading(null);
      setText(res.event.refund_policy_text);
      onConfirmed(res.event);
      toast.success(`Refund rule confirmed for ${event.title}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The rule could not be confirmed. Please retry.");
    } finally {
      setBusy(null);
    }
  }

  const textareaId = `policy-${event.id}`;

  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/events/${event.id}`} className="font-medium underline-offset-4 hover:underline">
          {event.title}
        </Link>
        {confirmed ? (
          <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-900">
            Rule confirmed
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
            Rule not confirmed
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatEventDay(event.starts_at, event.timezone)} · {event.venue}
      </p>

      {!confirmed && (
        <p className="mt-3 text-sm text-amber-900">
          Holders cannot release seats for this event until its refund rule is confirmed.
        </p>
      )}

      <label htmlFor={textareaId} className="mt-4 block text-sm font-medium">
        Refund policy, in your own words
      </label>
      <textarea
        id={textareaId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={MAX_POLICY_LENGTH}
        rows={3}
        disabled={busy !== null}
        className="mt-1.5 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        placeholder="For example: Resold seats are refunded at 90% of the ticket price. Within 24 hours of the start the refund is 75%."
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Say what a holder gets back when their released seat is resold: a percentage, a fee, a
          different rule for a ticket type, or a time limit before the start.
        </p>
        <Button variant={current ? "outline" : "default"} disabled={busy !== null || tooShort} onClick={read}>
          {busy === "reading" ? "Reading…" : current ? "Read again" : "Read policy"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {current?.status === "rejected" && (
        <div role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="flex items-center gap-2 font-medium">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            This policy could not be read cleanly. Nothing was changed.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {current.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p className="mt-2">Reword the policy above and read it again.</p>
        </div>
      )}

      {current?.status === "proposed" && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-medium">This is how the policy was understood</p>
          <div className="mt-2">
            <RuleClauses rule={current.rule} />
          </div>
          <p className="mt-3 text-sm font-medium">What holders would get back</p>
          <div className="mt-2">
            <RefundExamples
              rule={current.rule}
              tiers={event.ticket_tiers}
              startsAt={event.starts_at}
              timezone={event.timezone}
              now={now}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Confirming publishes this policy text and rule. Seats already released keep the rule
              they were released under.
            </p>
            <Button disabled={busy !== null} onClick={() => confirm(current.id)}>
              {busy === "confirming" ? "Confirming…" : "Confirm rule"}
            </Button>
          </div>
        </div>
      )}

      {!current && confirmed && event.refund_rule && (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CircleCheck className="size-4 shrink-0 text-emerald-700" aria-hidden />
            Rule in force
            {event.refund_rule_confirmed_at && (
              <span className="font-normal text-muted-foreground">
                confirmed {formatMoment(event.refund_rule_confirmed_at, event.timezone)}
              </span>
            )}
          </p>
          {!unchanged && (
            <p className="mt-1 text-sm text-muted-foreground">
              You have edited the text. The rule below stays in force until you read and confirm the new text.
            </p>
          )}
          <div className="mt-2 space-y-2">
            <RuleClauses rule={event.refund_rule} />
            <RefundExamples
              rule={event.refund_rule}
              tiers={event.ticket_tiers}
              startsAt={event.starts_at}
              timezone={event.timezone}
              now={now}
            />
          </div>
        </div>
      )}
    </li>
  );
}
