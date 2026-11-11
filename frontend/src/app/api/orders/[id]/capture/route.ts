import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { captureOrder } from "@/lib/orders";
import { requireProfile } from "@/lib/session";

/** Capture a buyer-approved order and issue tickets. Idempotent. */
export async function POST(_request: Request, ctx: RouteContext<"/api/orders/[id]/capture">) {
  try {
    const buyer = await requireProfile();
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) {
      throw new AppError(404, "order_not_found", "Order not found.");
    }
    return Response.json(await captureOrder(buyer, id));
  } catch (err) {
    return errorResponse(err, "POST /api/orders/[id]/capture");
  }
}
