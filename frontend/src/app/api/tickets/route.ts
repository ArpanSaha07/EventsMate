import { errorResponse } from "@/lib/errors";
import { requireProfile } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MyTicket } from "@/lib/types";

/** The current persona's tickets, soonest event first. Transferred tickets are history, not shown. */
export async function GET() {
  try {
    const owner = await requireProfile();
    const { data, error } = await supabaseAdmin()
      .from("tickets")
      .select(
        "id,ticket_number,status,unit_price_cents,created_at," +
          "tier:ticket_tiers(id,name)," +
          "event:events(id,title,venue,city,timezone,starts_at,ends_at)",
      )
      .eq("owner_id", owner.id)
      .in("status", ["valid", "released"])
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Could not load tickets: ${error.message}`);

    const tickets = (data as unknown as MyTicket[]).sort(
      (a, b) => new Date(a.event.starts_at).getTime() - new Date(b.event.starts_at).getTime(),
    );
    return Response.json({ tickets });
  } catch (err) {
    return errorResponse(err, "GET /api/tickets");
  }
}
