import type { EventWithTiers } from "@/lib/types";

export type ChatRole = "user" | "assistant";

export type BudgetSummary = {
  breakdown: string;
  totalSpentCents: number;
  budgetCents: number;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  events?: EventWithTiers[];
  budgetSummary?: BudgetSummary;
  clarification?: boolean;
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
