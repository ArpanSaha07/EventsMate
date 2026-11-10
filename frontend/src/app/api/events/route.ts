import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

const querySchema = z.object({
  city: z.string().trim().min(1).max(80).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

// Public fields only.
const PUBLIC_COLUMNS =
  "id,title,description,category,tags,venue,city,starts_at,ends_at,price_cents,currency,capacity,sold_count";

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return Response.json({ error: "Invalid query parameters." }, { status: 400 });
  }
  const { city, from, to } = parsed.data;

  try {
    let query = supabaseAdmin()
      .from("events")
      .select(PUBLIC_COLUMNS)
      .eq("status", "published")
      .order("starts_at", { ascending: true })
      .limit(50);
    if (city) query = query.ilike("city", city);
    if (from) query = query.gte("starts_at", from);
    if (to) query = query.lte("starts_at", to);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return Response.json({ events: data });
  } catch (err) {
    console.error("GET /api/events failed:", err);
    return Response.json({ error: "Could not load events. Please retry." }, { status: 503 });
  }
}
