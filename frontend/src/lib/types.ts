/** Shapes shared by Route Handlers and client components. No server imports here. */
import type { RefundRule } from "@/lib/refund-rule";

/** An event as its organiser sees it on "My events". */
export type ManagedEvent = {
  id: string;
  title: string;
  venue: string;
  city: string;
  timezone: string;
  starts_at: string;
  ends_at: string;
  refund_policy_text: string;
  refund_rule: RefundRule | null;
  refund_rule_confirmed_at: string | null;
  ticket_tiers: { id: string; name: string; price_cents: number; sort_order: number }[];
};

/** What the policy reader understood. Only a "proposed" reading can be confirmed. */
export type PolicyReadingResult =
  | { id: string; status: "proposed"; policy_text: string; rule: RefundRule; problems: [] }
  | { id: string; status: "rejected"; policy_text: string; rule: null; problems: string[] };

export type Tier = {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: "USD";
  capacity: number;
  sold_count: number;
  sort_order: number;
};

export type EventWithTiers = {
  id: string;
  title: string;
  description: string;
  category: string;
  venue: string;
  city: string;
  timezone: string;
  starts_at: string;
  ends_at: string;
  refund_policy_text: string;
  /** The organiser-confirmed structured rule; null until a policy has been read and confirmed. */
  refund_rule: RefundRule | null;
  /** Fans currently on standby with a hold in place. */
  standby_count: number;
  ticket_tiers: Tier[];
};

export type TicketStatus = "valid" | "released" | "transferred";

/** What the holder gets back if the seat is resold. Computed on the server only. */
export type TicketRefund = {
  refund_cents: number;
  /** The rule applied, in plain words: "90% of the price paid". */
  terms: string;
  /** The policy sentence the rule came from. */
  quote: string;
  /** The next moment the amount changes while the seat is unsold, if any. */
  next: { at: string; refund_cents: number; terms: string } | null;
};

/** Where a released seat's resale stands, for its holder. */
export type TicketResale = {
  /** in_progress: a fan was matched and the money is moving. resold: refunded and transferred. */
  state: "in_progress" | "resold";
  refund_cents: number;
  /** The rule applied, in plain words. */
  refund_terms: string;
  /** PayPal's refund reference. Set only once the refund has completed. */
  refund_id: string | null;
  resold_at: string | null;
};

export type MyTicket = {
  id: string;
  ticket_number: string;
  status: TicketStatus;
  unit_price_cents: number;
  created_at: string;
  released_at: string | null;
  /** Set when a released seat came back at the cutoff without being resold. */
  returned_at: string | null;
  /** Null when the seat can be released now; otherwise the reason it cannot. */
  release_blocked: string | null;
  /**
   * Valid ticket: what a release would pay under the event's current rule.
   * Released ticket: what it pays under the rule copied at release. Null if no rule.
   */
  refund: TicketRefund | null;
  /** Unmatched released seats return to the holder at this moment. */
  release_cutoff_at: string;
  /** Set once the agent has matched this seat to a fan. */
  resale: TicketResale | null;
  /** This ticket came from a standby match rather than a direct purchase. */
  from_standby: boolean;
  tier: { id: string; name: string };
  event: {
    id: string;
    title: string;
    venue: string;
    city: string;
    timezone: string;
    starts_at: string;
    ends_at: string;
  };
};

/** Error body returned by every Route Handler on failure. */
export type ApiError = { error: string; code?: string };

export type StandbyStatus =
  | "draft"
  | "authorized"
  | "matched"
  | "settled"
  | "cancelled"
  | "expired"
  | "failed";

export type MyStandbyRequest = {
  id: string;
  quantity: number;
  conditions_text: string;
  status: StandbyStatus;
  /** The PayPal hold: quantity x the most expensive accepted tier. */
  authorized_cents: number;
  /** What was actually charged once seats were found. Null until PayPal confirmed the capture. */
  captured_cents: number | null;
  /** PayPal's capture reference, once charged. */
  capture_id: string | null;
  authorized_at: string | null;
  expires_at: string;
  created_at: string;
  tiers: { id: string; name: string; price_cents: number }[];
  event: {
    id: string;
    title: string;
    venue: string;
    city: string;
    timezone: string;
    starts_at: string;
    ends_at: string;
  };
};
