import { listEvents } from "@/lib/events";

/** Published, upcoming events with their ticket tiers. */
export async function GET() {
  try {
    return Response.json({ events: await listEvents() });
  } catch (err) {
    console.error("GET /api/events failed:", err);
    return Response.json({ error: "Could not load events. Please retry." }, { status: 503 });
  }
}
