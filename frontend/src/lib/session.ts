import "server-only";
import { cookies } from "next/headers";
import { createSessionToken, readSessionToken } from "@/lib/session-token";
import { supabaseAdmin } from "@/lib/supabase/admin";

const COOKIE = "em_persona";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type Profile = {
  id: string;
  slug: string;
  name: string;
  role: "attendee" | "organiser";
  blurb: string;
};

const PROFILE_COLUMNS = "id,slug,name,role,blurb";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters.");
  }
  return value;
}

/** Demo people offered by the persona switcher. */
export async function listPersonas(): Promise<Profile[]> {
  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("switchable", true)
    .order("sort_order");
  if (error) throw new Error(`Could not load personas: ${error.message}`);
  return data as Profile[];
}

/** The persona this browser is acting as, or null if none is chosen or it no longer exists. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  const profileId = readSessionToken(token, secret());
  if (!profileId) return null;

  const { data, error } = await supabaseAdmin()
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", profileId)
    .eq("switchable", true)
    .maybeSingle();
  if (error) throw new Error(`Could not load the current persona: ${error.message}`);
  return (data as Profile | null) ?? null;
}

export async function setCurrentProfile(profileId: string): Promise<void> {
  (await cookies()).set(COOKIE, createSessionToken(profileId, secret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}
