import { z } from "zod";
import { getEvent } from "@/lib/events";

export async function GET(_request: Request, ctx: RouteContext<"/api/events/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Event not found." }, { status: 404 });
  }

  try {
    const event = await getEvent(id);
    if (!event) return Response.json({ error: "Event not found." }, { status: 404 });
    return Response.json({ event });
  } catch (err) {
    console.error("GET /api/events/[id] failed:", err);
    return Response.json({ error: "Could not load this event. Please retry." }, { status: 503 });
  }
}
