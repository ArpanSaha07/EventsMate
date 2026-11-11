import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { requireProfile } from "@/lib/session";
import { cancelStandbyRequest } from "@/lib/standby";

/** Leave the queue and release the PayPal hold. Idempotent. */
export async function POST(_request: Request, ctx: RouteContext<"/api/standby/[id]/cancel">) {
  try {
    const fan = await requireProfile();
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) {
      throw new AppError(404, "standby_not_found", "Standby request not found.");
    }
    return Response.json(await cancelStandbyRequest(fan, id));
  } catch (err) {
    return errorResponse(err, "POST /api/standby/[id]/cancel");
  }
}
