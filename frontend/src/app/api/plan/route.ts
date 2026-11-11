import { listEvents } from "@/lib/events";
import { getCurrentProfile } from "@/lib/session";
import { planEvents } from "@/lib/discovery/planner";
import type { PlanApiRequest } from "@/lib/discovery/types";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PlanApiRequest;
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return Response.json({ error: "Messages array is required." }, { status: 400 });
    }

    const [events, profile] = await Promise.all([
      listEvents(),
      getCurrentProfile(),
    ]);

    const result = await planEvents(body.messages, events, body.preferences ?? {}, profile);

    return Response.json(result);
  } catch (err) {
    console.error("POST /api/plan error:", err);
    return Response.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "An unexpected error occurred while planning events. Please try again.",
      },
      { status: 500 },
    );
  }
}

