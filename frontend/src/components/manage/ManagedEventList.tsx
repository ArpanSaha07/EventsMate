"use client";

import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { PolicyCard } from "@/components/manage/PolicyCard";
import { usePersona } from "@/components/shell/PersonaProvider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ManagedEvent } from "@/lib/types";
import { useApi } from "@/lib/use-api";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-8 text-center">
      <ClipboardList className="mx-auto size-6 text-muted-foreground" aria-hidden />
      <p className="mt-3 font-medium">{title}</p>
      <div className="mt-1 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

export function ManagedEventList() {
  const { status: personaStatus, current } = usePersona();
  const isOrganiser = current?.role === "organiser";
  const { status, data, error, reload } = useApi<{ events: ManagedEvent[] }>(
    isOrganiser ? "/api/manage/events" : null,
    [current?.id],
  );
  // Confirmed events returned by the server replace the listed copy without a refetch.
  const [updated, setUpdated] = useState<Record<string, ManagedEvent>>({});

  if (personaStatus === "ready" && !isOrganiser) {
    return (
      <Panel title="This page is for the organiser">
        Use the menu at the top right to switch to the organiser.
      </Panel>
    );
  }
  if (personaStatus !== "ready" || status === "loading") {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="font-medium">Your events could not be loaded</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button className="mt-4" variant="outline" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (data.events.length === 0) {
    return <Panel title={`${current?.name} has no upcoming events`}>Nothing to manage yet.</Panel>;
  }

  const events = data.events.map((event) => updated[event.id] ?? event);
  const pending = events.filter((event) => event.refund_rule === null).length;

  return (
    <>
      {pending > 0 && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {pending} of {events.length} events {pending === 1 ? "has" : "have"} no confirmed refund rule
          yet. Read and confirm each policy so holders can release seats.
        </p>
      )}
      <ul className="space-y-4">
        {events.map((event) => (
          <PolicyCard
            key={event.id}
            event={event}
            onConfirmed={(next) => setUpdated((all) => ({ ...all, [next.id]: next }))}
          />
        ))}
      </ul>
    </>
  );
}
