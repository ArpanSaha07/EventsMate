import { errorResponse } from "@/lib/errors";
import { requireProfile } from "@/lib/session";
import { listMyTickets } from "@/lib/tickets";

/** The current persona's tickets, soonest event first, with what a release would pay. */
export async function GET() {
  try {
    const owner = await requireProfile();
    return Response.json({ tickets: await listMyTickets(owner) });
  } catch (err) {
    return errorResponse(err, "GET /api/tickets");
  }
}
