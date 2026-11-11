"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, RotateCcw, AlertCircle, Bot, User } from "lucide-react";
import { BuyDialog } from "@/components/checkout/BuyDialog";
import { ActionPrompt } from "@/components/discovery/ActionPrompt";
import { SuggestionChips } from "@/components/discovery/SuggestionChips";
import { EventCard } from "@/components/events/EventCard";
import { usePersona } from "@/components/shell/PersonaProvider";
import { StandbyDialog } from "@/components/standby/StandbyDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import type { ChatMessage, PlanApiResponse, SessionPreferences } from "@/lib/discovery/types";
import type { EventWithTiers, Tier } from "@/lib/types";

export function PlanChat() {
  const { current } = usePersona();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<SessionPreferences>({});
  const [lastUserPrompt, setLastUserPrompt] = useState<string | null>(null);

  // Active dialog states for existing checkout and standby
  const [activeBuy, setActiveBuy] = useState<{
    open: boolean;
    event: EventWithTiers | null;
    tier: Tier | null;
    quantity: number;
  }>({ open: false, event: null, tier: null, quantity: 1 });

  const [activeStandby, setActiveStandby] = useState<{
    open: boolean;
    event: EventWithTiers | null;
    initialTierId: string | null;
  }>({ open: false, event: null, initialTierId: null });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, error]);

  const sendMessage = async (contentToSend: string) => {
    const text = contentToSend.trim();
    if (!text || loading) return;

    setError(null);
    setLastUserPrompt(text);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    const updatedHistory = [...messages, userMessage];
    setMessages(updatedHistory);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedHistory.map((m) => ({ role: m.role, content: m.content })),
          preferences,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${response.status}`);
      }

      const data = (await response.json()) as PlanApiResponse;
      setMessages((prev) => [...prev, data.message]);
      if (data.preferences) {
        setPreferences(data.preferences);
      }
    } catch (err) {
      console.error("PlanChat fetch error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not get event recommendations. Please try again.",
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleRetry = () => {
    if (lastUserPrompt) {
      setMessages((prev) =>
        prev.length > 0 && prev[prev.length - 1].role === "user" ? prev.slice(0, -1) : prev,
      );
      sendMessage(lastUserPrompt);
    }
  };

  const handleConfirmPurchase = (
    messageId: string,
    event: EventWithTiers,
    tierId: string,
    quantity: number,
  ) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.actionProposal
          ? {
              ...m,
              actionProposal: {
                ...m.actionProposal,
                selectedTierId: tierId,
                status: "confirmed" as const,
              },
            }
          : m,
      ),
    );

    const chosenTier =
      event.ticket_tiers.find((t) => t.id === tierId) ?? event.ticket_tiers[0];
    if (chosenTier) {
      setActiveBuy({
        open: true,
        event,
        tier: chosenTier,
        quantity,
      });
    }
  };

  const handlePaid = (event: EventWithTiers, tier: Tier, quantity: number) => {
    setActiveBuy({ open: false, event: null, tier: null, quantity: 1 });
    const successMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: `🎉 Payment verified! Your ${quantity} ticket${quantity > 1 ? "s" : ""} for "${event.title}" (${tier.name} - ${formatMoney(tier.price_cents * quantity)}) have been issued.\n\nYou can view your tickets in My tickets (/tickets).`,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, successMsg]);
  };

  const handleConfirmStandby = (messageId: string, event: EventWithTiers, tierId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.actionProposal
          ? {
              ...m,
              actionProposal: {
                ...m.actionProposal,
                selectedTierId: tierId,
                status: "confirmed" as const,
              },
            }
          : m,
      ),
    );

    setActiveStandby({
      open: true,
      event,
      initialTierId: tierId,
    });
  };

  const handleAuthorized = (event: EventWithTiers, tierId: string) => {
    setActiveStandby({ open: false, event: null, initialTierId: null });
    const chosenTier = event.ticket_tiers.find((t) => t.id === tierId);
    const tierName = chosenTier ? ` for ${chosenTier.name}` : "";
    const successMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: `⏳ You're on standby! A PayPal hold is in place with no upfront charge for "${event.title}"${tierName}.\n\nIf a seat frees up before cutoff, the ticket will be issued automatically. You can manage your request in Standby (/standby).`,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, successMsg]);
  };

  const handleDecline = (messageId: string, type: "purchase" | "standby") => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.actionProposal
          ? {
              ...m,
              actionProposal: {
                ...m.actionProposal,
                status: "declined" as const,
              },
            }
          : m,
      ),
    );

    const declineMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        type === "purchase"
          ? "No problem! Would you like to refine your search, adjust your budget, or explore different dates?"
          : "Understood! Let me know if you would like to explore other upcoming events with open seats instead.",
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, declineMsg]);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)] max-w-4xl mx-auto rounded-2xl border bg-card shadow-sm overflow-hidden">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/40">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" aria-hidden />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Plan with AI</h2>
            <p className="text-xs text-muted-foreground">Find events by topic, date, or budget</p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMessages([]);
              setPreferences({});
              setError(null);
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear chat
          </Button>
        )}
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-10 px-4 space-y-6">
            <div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Sparkles className="size-6" aria-hidden />
            </div>
            <div className="max-w-md space-y-2">
              <h3 className="text-lg font-semibold tracking-tight">What are you looking for?</h3>
              <p className="text-sm text-muted-foreground">
                Ask naturally about events, dates, and budgets. All recommendations come strictly from our
                upcoming San Francisco schedule.
              </p>
            </div>
            <div className="w-full max-w-xl pt-2">
              <SuggestionChips onSelect={(text) => sendMessage(text)} disabled={loading} />
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.role === "assistant" && (
                <div className="flex size-7 shrink-0 select-none items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                  <Bot className="size-4" aria-hidden />
                </div>
              )}

              <div
                className={`flex flex-col space-y-3 max-w-[85%] sm:max-w-[78%] ${
                  message.role === "user" ? "items-end" : "items-start"
                }`}
              >
                {/* Bubble */}
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground rounded-tr-sm"
                      : "bg-muted/70 text-foreground rounded-tl-sm border"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>

                  {/* Budget summary badge if available */}
                  {message.budgetSummary && (
                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-xs">
                      <span className="font-semibold text-primary">Budget:</span>
                      <span>{message.budgetSummary.breakdown}</span>
                    </div>
                  )}
                </div>

                {/* Event Cards Grid */}
                {message.events && message.events.length > 0 && (
                  <div className="w-full grid gap-3 sm:grid-cols-2 pt-1">
                    {message.events.map((ev) => (
                      <EventCard key={ev.id} event={ev} />
                    ))}
                  </div>
                )}

                {/* Action Prompt (Purchase or Standby) */}
                {message.actionProposal && message.events && message.events.length > 0 && (
                  <ActionPrompt
                    proposal={message.actionProposal}
                    isLoggedIn={Boolean(current)}
                    onConfirmPurchase={(tierId, qty) =>
                      handleConfirmPurchase(message.id, message.events![0], tierId, qty)
                    }
                    onConfirmStandby={(tierId) =>
                      handleConfirmStandby(message.id, message.events![0], tierId)
                    }
                    onDecline={() => handleDecline(message.id, message.actionProposal!.type)}
                  />
                )}
              </div>

              {message.role === "user" && (
                <div className="flex size-7 shrink-0 select-none items-center justify-center rounded-full bg-muted text-muted-foreground mt-0.5">
                  <User className="size-4" aria-hidden />
                </div>
              )}
            </div>
          ))
        )}

        {/* Loading Bubble */}
        {loading && (
          <div className="flex gap-3 justify-start" aria-live="polite">
            <div className="flex size-7 shrink-0 select-none items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
              <Bot className="size-4" aria-hidden />
            </div>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border bg-muted/70 px-4 py-3 text-sm text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex size-2 rounded-full bg-primary"></span>
              </span>
              <span>Searching events and calculating budget...</span>
            </div>
          </div>
        )}

        {/* Inline Error with Retry */}
        {error && (
          <div
            className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-sm text-destructive"
            role="alert"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              className="h-7 text-xs border-destructive/30 hover:bg-destructive/10 text-destructive gap-1"
            >
              <RotateCcw className="size-3" aria-hidden />
              Retry
            </Button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Follow-up Quick Chips */}
      {messages.length > 0 && !loading && (
        <div className="px-4 py-2 border-t bg-muted/20 flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => sendMessage("Make it cheaper")}
            className="text-xs h-6 px-2.5 rounded-full border border-border bg-background hover:bg-muted"
          >
            Make it cheaper
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => sendMessage("Only Saturday")}
            className="text-xs h-6 px-2.5 rounded-full border border-border bg-background hover:bg-muted"
          >
            Only Saturday
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => sendMessage("Show me something else")}
            className="text-xs h-6 px-2.5 rounded-full border border-border bg-background hover:bg-muted"
          >
            Show me something else
          </Button>
        </div>
      )}

      {/* Input Area */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(input);
        }}
        className="p-3 border-t bg-background flex items-center gap-2"
      >
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about events, dates, or budgets..."
          disabled={loading}
          className="flex-1 focus-visible:ring-primary/40 text-sm"
        />
        <Button
          type="submit"
          disabled={loading || !input.trim()}
          size="sm"
          aria-label="Send message"
          className="h-8 px-3 gap-1.5"
        >
          <Send className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">Send</span>
        </Button>
      </form>

      {/* Existing Buy Dialog triggered from chat */}
      {activeBuy.open && activeBuy.event && activeBuy.tier && (
        <BuyDialog
          event={activeBuy.event}
          tier={activeBuy.tier}
          open={activeBuy.open}
          onOpenChange={(open) => setActiveBuy((prev) => ({ ...prev, open }))}
          onPaid={() => handlePaid(activeBuy.event!, activeBuy.tier!, activeBuy.quantity)}
        />
      )}

      {/* Existing Standby Dialog triggered from chat */}
      {activeStandby.open && activeStandby.event && activeStandby.initialTierId && (
        <StandbyDialog
          event={activeStandby.event}
          initialTierId={activeStandby.initialTierId}
          open={activeStandby.open}
          onOpenChange={(open) => setActiveStandby((prev) => ({ ...prev, open }))}
          onAuthorized={() =>
            handleAuthorized(activeStandby.event!, activeStandby.initialTierId!)
          }
        />
      )}
    </div>
  );
}
