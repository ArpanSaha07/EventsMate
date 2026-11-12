import OpenAI from "openai";
import { verifyPayPalCredentials } from "@/lib/paypal/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Check = { ok: boolean; detail: string };

async function run(fn: () => Promise<string>): Promise<Check> {
  try {
    return { ok: true, detail: await fn() };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Setup check: live round-trips to each integration. Never returns secret values. */
export async function GET() {
  const [supabase, paypal, openai] = await Promise.all([
    run(async () => {
      const { count, error } = await supabaseAdmin()
        .from("events")
        .select("id", { count: "exact", head: true });
      if (error) throw new Error(`Supabase query failed: ${error.message}`);
      if (!count) throw new Error("Connected, but the events table is empty: run `npm run db:push` then `npm run db:seed`.");
      return `Connected; ${count} events seeded.`;
    }),
    run(async () => {
      await verifyPayPalCredentials();
      if (process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID !== process.env.PAYPAL_CLIENT_ID) {
        throw new Error("Credentials valid, but NEXT_PUBLIC_PAYPAL_CLIENT_ID must equal PAYPAL_CLIENT_ID.");
      }
      return "Sandbox credentials accepted.";
    }),
    run(async () => {
      const model = process.env.OPENAI_MODEL;
      if (!process.env.OPENAI_API_KEY || !model) {
        throw new Error("OpenAI is not configured: set OPENAI_API_KEY and OPENAI_MODEL.");
      }
      await new OpenAI().models.retrieve(model);
      return `Key accepted; model ${model} is available.`;
    }),
  ]);

  const session: Check =
    (process.env.SESSION_SECRET?.length ?? 0) >= 32
      ? { ok: true, detail: "Session secret set." }
      : { ok: false, detail: "Set SESSION_SECRET to at least 32 characters." };

  const checks = { supabase, paypal, openai, session };
  const ok = Object.values(checks).every((c) => c.ok);
  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}
