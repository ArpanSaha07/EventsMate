/** Shapes shared by Route Handlers and client components. No server imports here. */

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
  /** Fans currently on standby with a hold in place. */
  standby_count: number;
  ticket_tiers: Tier[];
};

export type TicketStatus = "valid" | "released" | "transferred";

export type MyTicket = {
  id: string;
  ticket_number: string;
  status: TicketStatus;
  unit_price_cents: number;
  created_at: string;
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
