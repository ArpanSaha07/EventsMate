import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { requireProfile } from "@/lib/session";
import { runMatchingQuietly } from "@/lib/settlement";
import { MAX_TICKETS_PER_RELEASE, listMyTickets, releaseTickets } from "@/lib/tickets";

// Only ticket ids are accepted: the refund is computed on the server from the confirmed rule.
const bodySchema = z.object({ ticketIds: z.array(z.uuid()).min(1).max(MAX_TICKETS_PER_RELEASE) });

/**
 * Release one or more of the current persona's tickets for one event, then let
 * the agent match them to fans on standby (D51). Idempotent: a repeat releases
 * nothing new and only retries matching. The returned tickets show whether
 * each seat is waiting, being resold, or resold.
 */
export async function POST(request: Request) {
  try {
    const owner = await requireProfile();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", `Choose 1 to ${MAX_TICKETS_PER_RELEASE} tickets to release.`);
    }
    const ids = parsed.data.ticketIds;
    const { releasedCount, eventId } = await releaseTickets(owner, ids);
    await runMatchingQuietly(eventId);
    const tickets = (await listMyTickets(owner)).filter((ticket) => ids.includes(ticket.id));
    return Response.json({ releasedCount, tickets });
  } catch (err) {
    return errorResponse(err, "POST /api/tickets/release");
  }
}
