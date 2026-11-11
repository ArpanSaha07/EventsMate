import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { requireProfile } from "@/lib/session";
import { authorizeStandbyRequest } from "@/lib/standby";

/** Place the PayPal hold for a fan-approved request and join the queue. Idempotent. */
export async function POST(_request: Request, ctx: RouteContext<"/api/standby/[id]/authorize">) {
  try {
    const fan = await requireProfile();
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) {
      throw new AppError(404, "standby_not_found", "Standby request not found.");
    }
    return Response.json(await authorizeStandbyRequest(fan, id));
  } catch (err) {
    return errorResponse(err, "POST /api/standby/[id]/authorize");
  }
}
