import type { EventWithTiers, MyStandbyRequest, Tier } from "@/lib/types";

export type ChatRole = "user" | "assistant";

export type PlannerIntent =
  | "discover"
  | "my_tickets"
  | "upcoming"
  | "standby_status"
  | "other";

export type BudgetSummary = {
  breakdown: string;
  totalSpentCents: number;
  budgetCents: number;
};

export type PurchaseActionProposal = {
  type: "purchase";
  eventId: string;
  selectedTierId: string;
  availableTiers: Tier[];
  soldOutTiers?: Tier[];
  promptText: string;
  status: "pending" | "confirmed" | "declined";
};

export type StandbyActionProposal = {
  type: "standby";
  eventId: string;
  selectedTierId: string;
  soldOutTiers: Tier[];
  promptText: string;
  status: "pending" | "confirmed" | "declined";
};

export type ActionProposal = PurchaseActionProposal | StandbyActionProposal;

export type GroupedTicketItem = {
  eventId: string;
  eventTitle: string;
  venue: string;
  city: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  tierId: string;
  tierName: string;
  quantity: number;
  totalPriceCents: number;
  status: "valid" | "released" | "transferred";
  ticketNumbers: string[];
  howSoon?: string;
  overlapsWith?: string[];
};

export type UserTicketsPayload = {
  upcoming: GroupedTicketItem[];
  past: GroupedTicketItem[];
  other: GroupedTicketItem[];
};

export type UpcomingSchedulePayload = {
  nextEvent?: GroupedTicketItem;
  events: GroupedTicketItem[];
  hasOverlaps: boolean;
};

export type StandbyStatusItem = {
  id: string;
  eventId: string;
  eventTitle: string;
  venue: string;
  timezone: string;
  startsAt: string;
  tiersSummary: string;
  quantity: number;
  status: MyStandbyRequest["status"];
  statusDescription: string;
  authorizedCents: number;
  isHoldActive: boolean;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  intent?: PlannerIntent;
  /** Matching events with at least one tier on sale. */
  events?: EventWithTiers[];
  /** Matching events where every tier is sold out; shown after `events`. */
  soldOutEvents?: EventWithTiers[];
  budgetSummary?: BudgetSummary;
  userTickets?: UserTicketsPayload;
  upcomingSchedule?: UpcomingSchedulePayload;
  standbySummary?: StandbyStatusItem[];
  requiresAuth?: boolean;
  clarification?: boolean;
  actionProposal?: ActionProposal;
  createdAt: string;
};

export type DateRangeConstraint = {
  startIso?: string;
  endIso?: string;
  label?: string;
};

export type UserConstraints = {
  topics?: string[];
  category?: string;
  dateRange?: DateRangeConstraint;
  totalBudgetCents?: number | null;
  perTicketBudgetCents?: number | null;
  count?: number | null;
  freeOnly?: boolean;
};

export type SessionPreferences = UserConstraints;

export type PlanApiRequest = {
  messages: Array<{ role: ChatRole; content: string }>;
  preferences?: SessionPreferences;
};

export type PlanApiResponse = {
  message: ChatMessage;
  preferences: SessionPreferences;
};

