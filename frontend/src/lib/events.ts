import "server-only";
import { standbyCountsByEvent } from "@/lib/standby";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { EventWithTiers } from "@/lib/types";

// Public fields only.
const EVENT_COLUMNS =
  "id,title,description,category,venue,city,timezone,starts_at,ends_at,refund_policy_text," +
  "ticket_tiers(id,name,description,price_cents,currency,capacity,sold_count,sort_order)";

/** Published events that have not ended, soonest first, each with its tiers. */
export async function listEvents(): Promise<EventWithTiers[]> {
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("status", "published")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .order("sort_order", { referencedTable: "ticket_tiers", ascending: true })
    .limit(50);
  if (error) throw new Error(`Could not load events: ${error.message}`);
  return withStandbyCounts(data as unknown as Omit<EventWithTiers, "standby_count">[]);
}

/** One published event with its tiers, or null if it does not exist. */
export async function getEvent(id: string): Promise<EventWithTiers | null> {
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", id)
    .eq("status", "published")
    .order("sort_order", { referencedTable: "ticket_tiers", ascending: true })
    .maybeSingle();
  if (error) throw new Error(`Could not load event: ${error.message}`);
  if (!data) return null;
  const [event] = await withStandbyCounts([data as unknown as Omit<EventWithTiers, "standby_count">]);
  return event;
}

async function withStandbyCounts(
  events: Omit<EventWithTiers, "standby_count">[],
): Promise<EventWithTiers[]> {
  const counts = await standbyCountsByEvent(events.map((event) => event.id));
  return events.map((event) => ({ ...event, standby_count: counts.get(event.id) ?? 0 }));
}
