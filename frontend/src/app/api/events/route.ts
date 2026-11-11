import { supabaseAdmin } from "@/lib/supabase/admin";

// Public fields only.
const EVENT_COLUMNS =
  "id,title,description,category,venue,city,timezone,starts_at,ends_at,refund_policy_text," +
  "ticket_tiers(id,name,description,price_cents,currency,capacity,sold_count,sort_order)";

/** Published, upcoming events with their ticket tiers. */
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin()
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("status", "published")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .order("sort_order", { referencedTable: "ticket_tiers", ascending: true })
      .limit(50);
    if (error) throw new Error(error.message);
    return Response.json({ events: data });
  } catch (err) {
    console.error("GET /api/events failed:", err);
    return Response.json({ error: "Could not load events. Please retry." }, { status: 503 });
  }
}
