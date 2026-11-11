import "server-only";
import { readPolicyWithModel } from "@/lib/ai/read-policy";
import { AppError } from "@/lib/errors";
import { checkProposal } from "@/lib/policy-proposal";
import { parseRefundRule } from "@/lib/refund-rule";
import type { Profile } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ManagedEvent, PolicyReadingResult } from "@/lib/types";

function requireOrganiser(profile: Profile): void {
  if (profile.role !== "organiser") {
    throw new AppError(
      403,
      "organiser_only",
      "Only the organiser can manage refund policies. Switch to the organiser (top right).",
    );
  }
}

const MANAGED_COLUMNS =
  "id,organiser_id,title,venue,city,timezone,starts_at,ends_at,refund_policy_text,refund_rule,refund_rule_confirmed_at," +
  "ticket_tiers(id,name,price_cents,sort_order)";

type ManagedRow = Omit<ManagedEvent, "refund_rule"> & { organiser_id: string; refund_rule: unknown };

function toManaged(row: ManagedRow): ManagedEvent {
  const { organiser_id, refund_rule, ...rest } = row;
  void organiser_id;
  return { ...rest, refund_rule: parseRefundRule(refund_rule) };
}

/** The organiser's own events that have not ended, soonest first. */
export async function listManagedEvents(organiser: Profile): Promise<ManagedEvent[]> {
  requireOrganiser(organiser);
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select(MANAGED_COLUMNS)
    .eq("organiser_id", organiser.id)
    .eq("status", "published")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .order("sort_order", { referencedTable: "ticket_tiers", ascending: true })
    .limit(50);
  if (error) throw new Error(`Could not load events: ${error.message}`);
  return (data as unknown as ManagedRow[]).map(toManaged);
}

async function loadOwnEvent(organiser: Profile, eventId: string): Promise<ManagedRow> {
  requireOrganiser(organiser);
  const { data, error } = await supabaseAdmin()
    .from("events")
    .select(MANAGED_COLUMNS)
    .eq("id", eventId)
    .eq("status", "published")
    .order("sort_order", { referencedTable: "ticket_tiers", ascending: true })
    .maybeSingle();
  if (error) throw new Error(`Could not load event: ${error.message}`);
  const row = data as unknown as ManagedRow | null;
  // Same answer for "missing" and "someone else's" so ids cannot be probed.
  if (!row || row.organiser_id !== organiser.id) {
    throw new AppError(404, "event_not_found", "Event not found.");
  }
  return row;
}

/**
 * Reads a policy with the model, validates the proposal in code and stores the
 * reading. Changes nothing about the event: the organiser must confirm.
 */
export async function readPolicy(
  organiser: Profile,
  eventId: string,
  policyText: string,
): Promise<PolicyReadingResult> {
  const db = supabaseAdmin();
  const event = await loadOwnEvent(organiser, eventId);

  const { proposal, model } = await readPolicyWithModel(
    policyText,
    event.ticket_tiers.map((tier) => tier.name),
  );
  const verdict = checkProposal(proposal, policyText, event.ticket_tiers);

  // A new reading replaces any earlier unconfirmed one.
  const { error: retireError } = await db
    .from("policy_readings")
    .update({ status: "superseded" })
    .eq("event_id", event.id)
    .eq("status", "proposed");
  if (retireError) throw new Error(`Could not retire earlier readings: ${retireError.message}`);

  const { data, error } = await db
    .from("policy_readings")
    .insert({
      event_id: event.id,
      organiser_id: organiser.id,
      policy_text: policyText,
      status: verdict.ok ? "proposed" : "rejected",
      rule: verdict.ok ? verdict.rule : null,
      model_output: proposal,
      problems: verdict.ok ? [] : verdict.problems,
      model,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not save the reading: ${error.message}`);

  return verdict.ok
    ? { id: data.id, status: "proposed", policy_text: policyText, rule: verdict.rule, problems: [] }
    : { id: data.id, status: "rejected", policy_text: policyText, rule: null, problems: verdict.problems };
}

/**
 * Publishes a proposed reading as the event's policy text and rule, in one
 * database transaction. The rule is re-validated first. Safe to call again.
 */
export async function confirmPolicy(
  organiser: Profile,
  eventId: string,
  readingId: string,
): Promise<ManagedEvent> {
  const db = supabaseAdmin();
  const event = await loadOwnEvent(organiser, eventId);

  const { data: reading, error } = await db
    .from("policy_readings")
    .select("id,event_id,status,rule")
    .eq("id", readingId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the reading: ${error.message}`);
  if (!reading || reading.event_id !== event.id) {
    throw new AppError(404, "reading_not_found", "That reading was not found. Read the policy again.");
  }

  if (reading.status !== "confirmed") {
    if (reading.status !== "proposed") {
      throw new AppError(
        409,
        "reading_not_confirmable",
        reading.status === "superseded"
          ? "A newer reading replaced this one. Read the policy again."
          : "This reading had problems and cannot be confirmed. Reword the policy and read it again.",
      );
    }
    // Re-check against the tiers as they are now: a rule may not name a tier that no longer exists.
    const rule = parseRefundRule(reading.rule);
    const tierIds = new Set(event.ticket_tiers.map((tier) => tier.id));
    if (!rule || rule.clauses.some((c) => c.tier_id !== null && !tierIds.has(c.tier_id))) {
      throw new AppError(409, "reading_stale", "This reading no longer matches the event. Read the policy again.");
    }

    const { error: rpcError } = await db.rpc("confirm_policy_reading", {
      p_reading_id: reading.id,
      p_organiser_id: organiser.id,
    });
    if (rpcError) {
      if (rpcError.message.includes("reading_not_confirmable")) {
        throw new AppError(409, "reading_not_confirmable", "A newer reading replaced this one. Read the policy again.");
      }
      throw new Error(`Could not confirm the reading: ${rpcError.message}`);
    }
  }

  return toManaged(await loadOwnEvent(organiser, eventId));
}
