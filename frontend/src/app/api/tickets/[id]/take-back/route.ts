import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { requireProfile } from "@/lib/session";
import { takeBackTicket } from "@/lib/tickets";

/** Take a released seat back before it is resold. Idempotent. */
export async function POST(_request: Request, ctx: RouteContext<"/api/tickets/[id]/take-back">) {
  try {
    const owner = await requireProfile();
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) {
      throw new AppError(404, "ticket_not_found", "One of those tickets was not found.");
    }
    return Response.json(await takeBackTicket(owner, id));
  } catch (err) {
    return errorResponse(err, "POST /api/tickets/[id]/take-back");
  }
}
