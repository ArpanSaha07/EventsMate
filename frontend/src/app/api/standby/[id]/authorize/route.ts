import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { requireProfile } from "@/lib/session";
import { runMatchingQuietly } from "@/lib/settlement";
import { authorizeStandbyRequest, getStandbyOutcome } from "@/lib/standby";

/**
 * Place the PayPal hold for a fan-approved request and join the queue, then
 * let the agent match it to seats that are already released (D51). Idempotent.
 * The returned status is "authorized" while waiting, or "settled" with the
 * amount charged when seats were found straight away.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/standby/[id]/authorize">) {
  try {
    const fan = await requireProfile();
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) {
      throw new AppError(404, "standby_not_found", "Standby request not found.");
    }
    const placed = await authorizeStandbyRequest(fan, id);
    if (placed.status === "settled") return Response.json(placed);
    await runMatchingQuietly(placed.eventId);
    return Response.json(await getStandbyOutcome(fan, id));
  } catch (err) {
    return errorResponse(err, "POST /api/standby/[id]/authorize");
  }
}
