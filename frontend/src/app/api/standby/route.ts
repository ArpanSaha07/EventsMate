import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { MAX_TICKETS_PER_ORDER } from "@/lib/rules";
import { requireProfile } from "@/lib/session";
import { createStandbyRequest, listMyStandbyRequests } from "@/lib/standby";

/** The current persona's standby requests. */
export async function GET() {
  try {
    const fan = await requireProfile();
    return Response.json({ requests: await listMyStandbyRequests(fan) });
  } catch (err) {
    return errorResponse(err, "GET /api/standby");
  }
}

// No amount is accepted from the browser: the hold is computed from tier prices.
const bodySchema = z.object({
  eventId: z.uuid(),
  tierIds: z.array(z.uuid()).min(1).max(10),
  quantity: z.int().min(1).max(MAX_TICKETS_PER_ORDER),
  conditionsText: z.string().trim().max(300).default(""),
});

/** Start a standby request. Returns the PayPal order id for the fan to approve the hold. */
export async function POST(request: Request) {
  try {
    const fan = await requireProfile();
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(
        400,
        "invalid_request",
        "Choose at least one ticket type, 1 to 4 seats, and keep your note under 300 characters.",
      );
    }
    return Response.json(await createStandbyRequest(fan, parsed.data));
  } catch (err) {
    return errorResponse(err, "POST /api/standby");
  }
}
