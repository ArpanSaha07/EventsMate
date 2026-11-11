import { errorResponse } from "@/lib/errors";
import { listManagedEvents } from "@/lib/policy";
import { requireProfile } from "@/lib/session";

/** The organiser's own events with their refund policy and confirmed rule. */
export async function GET() {
  try {
    const organiser = await requireProfile();
    return Response.json({ events: await listManagedEvents(organiser) });
  } catch (err) {
    return errorResponse(err, "GET /api/manage/events");
  }
}
