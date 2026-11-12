import { z } from "zod";
import { AppError, errorResponse } from "@/lib/errors";
import { readPolicy } from "@/lib/policy";
import { MAX_POLICY_LENGTH } from "@/lib/refund-rule";
import { requireProfile } from "@/lib/session";

const bodySchema = z.object({ policyText: z.string().trim().min(10).max(MAX_POLICY_LENGTH) });

/** Ask the policy reader what a policy means. Stores a reading; changes nothing on the event. */
export async function POST(request: Request, ctx: RouteContext<"/api/manage/events/[id]/policy/read">) {
  try {
    const organiser = await requireProfile();
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) {
      throw new AppError(404, "event_not_found", "Event not found.");
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(
        400,
        "invalid_request",
        `Write the refund policy in 10 to ${MAX_POLICY_LENGTH} characters.`,
      );
    }
    return Response.json({ reading: await readPolicy(organiser, id, parsed.data.policyText) });
  } catch (err) {
    return errorResponse(err, "POST /api/manage/events/[id]/policy/read");
  }
}
