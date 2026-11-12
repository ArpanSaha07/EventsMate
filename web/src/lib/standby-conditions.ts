import "server-only";
import { readConditionsWithModel } from "@/lib/ai/standby-agent";
import { checkConditions, effectiveExpiry, parseStandbyConditions, type StandbyConditions } from "@/lib/conditions";
import { supabaseAdmin } from "@/lib/supabase/admin";

const NO_CONDITIONS: StandbyConditions = { version: 1, same_tier: false, decide_by: null, unsupported: [] };

function localMoment(value: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export type ConditionsState =
  | { read: true; conditions: StandbyConditions }
  /** The note exists but could not be read yet. Matching must not ignore it. */
  | { read: false };

/**
 * D55: reads a request's note once and stores what code will enforce. A
 * "decide by" deadline earlier than the cutoff also shortens the request, so
 * the normal expiry sweep ends it and voids the hold. Safe to call again:
 * stored conditions are returned as they are. Never throws.
 */
export async function ensureConditionsRead(requestId: string): Promise<ConditionsState> {
  try {
    const db = supabaseAdmin();
    const { data: row, error } = await db
      .from("standby_requests")
      .select("id,conditions_text,conditions,expires_at,event:events(timezone,starts_at)")
      .eq("id", requestId)
      .maybeSingle();
    if (error || !row) throw new Error(error?.message ?? "request not found");

    const note = (row.conditions_text as string).trim();
    if (!note) return { read: true, conditions: NO_CONDITIONS };
    const stored = parseStandbyConditions(row.conditions);
    if (stored) return { read: true, conditions: stored };

    const event = row.event as unknown as { timezone: string; starts_at: string };
    const now = new Date();
    const raw = await readConditionsWithModel(note, {
      timezone: event.timezone,
      nowLocal: localMoment(now, event.timezone),
      eventStartsLocal: localMoment(event.starts_at, event.timezone),
    });
    const conditions = checkConditions(raw, note, { timezone: event.timezone, now });

    const { error: saveError } = await db
      .from("standby_requests")
      .update({
        conditions,
        expires_at: effectiveExpiry(row.expires_at, conditions).toISOString(),
      })
      .eq("id", requestId)
      .is("conditions", null);
    if (saveError) throw new Error(saveError.message);
    return { read: true, conditions };
  } catch (err) {
    console.error("Could not read standby conditions", requestId, err);
    return { read: false };
  }
}
