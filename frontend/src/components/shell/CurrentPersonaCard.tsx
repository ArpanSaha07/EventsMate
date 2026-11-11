"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { usePersona } from "@/components/shell/PersonaProvider";

const ROLE_HINT = {
  attendee: "You can buy tickets, go on standby for sold-out seats, and release seats you can't use.",
  organiser: "You run the events: you set refund policies and see what the agent did.",
} as const;

/** Tells the visitor who they are acting as. Temporary home content until the events list lands. */
export function CurrentPersonaCard() {
  const { status, current } = usePersona();

  if (status === "loading") return <Skeleton className="h-20 w-full" />;
  if (status === "error") {
    return (
      <p className="rounded-lg border bg-card p-4 text-sm text-destructive">
        Demo people could not be loaded. Check the Supabase setup below.
      </p>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      {current ? (
        <>
          <p className="font-medium">
            You are acting as {current.name}
            <span className="font-normal text-muted-foreground"> · {current.blurb}</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{ROLE_HINT[current.role]}</p>
        </>
      ) : (
        <>
          <p className="font-medium">Choose a demo person to begin</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the menu at the top right. There are no passwords: switch freely between ticket
            holders, fans and the organiser.
          </p>
        </>
      )}
    </div>
  );
}
