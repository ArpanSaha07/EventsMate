import { z } from "zod";
import { getCurrentProfile, listPersonas, setCurrentProfile } from "@/lib/session";

/** Who this browser is acting as, plus the demo people it can switch to. */
export async function GET() {
  try {
    const [personas, current] = await Promise.all([listPersonas(), getCurrentProfile()]);
    return Response.json({ personas, current });
  } catch (err) {
    console.error("GET /api/session failed:", err);
    return Response.json({ error: "Could not load demo people. Please retry." }, { status: 503 });
  }
}

const bodySchema = z.object({ profileId: z.uuid() });

/** Switch persona. Only seeded, switchable profiles are accepted. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const persona = (await listPersonas()).find((p) => p.id === parsed.data.profileId);
    if (!persona) {
      return Response.json({ error: "Unknown demo person." }, { status: 404 });
    }
    await setCurrentProfile(persona.id);
    return Response.json({ current: persona });
  } catch (err) {
    console.error("POST /api/session failed:", err);
    return Response.json({ error: "Could not switch person. Please retry." }, { status: 503 });
  }
}
