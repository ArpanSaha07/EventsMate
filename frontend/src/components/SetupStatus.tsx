"use client";

import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type Check = { ok: boolean; detail: string };
type Health = { ok: boolean; checks: Record<string, Check> };

const LABELS: Record<string, string> = {
  supabase: "Supabase",
  paypal: "PayPal sandbox",
  openai: "OpenAI",
  session: "Guest session",
};

/** Live integration status from /api/health. Temporary home content until the chat UI lands. */
export function SetupStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return <p className="text-sm text-destructive">Could not reach /api/health.</p>;
  }
  if (!health) {
    return (
      <div className="space-y-3">
        {Object.keys(LABELS).map((key) => (
          <Skeleton key={key} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {Object.entries(health.checks).map(([key, check]) => (
        <li key={key} className="flex items-start gap-3 p-4">
          {check.ok ? (
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          ) : (
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="font-medium">{LABELS[key] ?? key}</p>
            <p className="text-sm break-words text-muted-foreground">{check.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
