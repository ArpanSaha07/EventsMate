import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/** Service-role Supabase client. Server-only: bypasses RLS, never import from client components. */
export function supabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  // Accept a pasted REST endpoint (".../rest/v1/") as well as the bare project URL.
  client = createClient(new URL(url).origin, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
