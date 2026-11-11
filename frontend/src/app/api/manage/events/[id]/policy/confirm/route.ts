import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { confirmPolicy } from "@/lib/policy";
import { requireProfile } from "@/lib/session";

// Only the id of a stored, validated reading is accepted: the rule itself never comes from the browser.
const bodySchema = z.object({ readingId: z.uuid() });

/** Publish a proposed reading as the event's policy and rule. Idempotent. */
export async function POST(request: Request, ctx: RouteContext<"/api/manage/events/[id]/policy/confirm">) {
  try {
    const organiser = await requireProfile();
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) {
      throw new AppError(404, "event_not_found", "Event not found.");
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", "Read the policy first, then confirm that reading.");
    }
    return Response.json({ event: await confirmPolicy(organiser, id, parsed.data.readingId) });
  } catch (err) {
    return errorResponse(err, "POST /api/manage/events/[id]/policy/confirm");
  }
}
