import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { requireProfile } from "@/lib/session";
import { MAX_TICKETS_PER_RELEASE, releaseTickets } from "@/lib/tickets";

// Only ticket ids are accepted: the refund is computed on the server from the confirmed rule.
const bodySchema = z.object({ ticketIds: z.array(z.uuid()).min(1).max(MAX_TICKETS_PER_RELEASE) });

/** Release one or more of the current persona's tickets for one event. Idempotent. */
export async function POST(request: Request) {
  try {
    const owner = await requireProfile();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", `Choose 1 to ${MAX_TICKETS_PER_RELEASE} tickets to release.`);
    }
    return Response.json(await releaseTickets(owner, parsed.data.ticketIds));
  } catch (err) {
    return errorResponse(err, "POST /api/tickets/release");
  }
}
