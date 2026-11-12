import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { createOrder } from "@/lib/orders";
import { MAX_TICKETS_PER_ORDER } from "@/lib/rules";
import { requireProfile } from "@/lib/session";

// No price, total or currency is accepted from the browser.
const bodySchema = z.object({
  tierId: z.uuid(),
  quantity: z.int().min(1).max(MAX_TICKETS_PER_ORDER),
});

/** Start a ticket purchase. Returns the PayPal order id for the buyer to approve. */
export async function POST(request: Request) {
  try {
    const buyer = await requireProfile();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", "Choose a ticket type and a quantity from 1 to 4.");
    }
    return Response.json(await createOrder(buyer, parsed.data));
  } catch (err) {
    return errorResponse(err, "POST /api/orders");
  }
}
