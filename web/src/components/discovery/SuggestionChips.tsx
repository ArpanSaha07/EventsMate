"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "Find me two AI workshops this weekend, with a total ticket budget of $40",
  "Show me all events",
  "Which events are sold out?",
  "What tickets do I have?",
  "Check my standby status",
];

export function SuggestionChips({
  onSelect,
  disabled,
}: {
  onSelect: (query: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mr-1">
        <Sparkles className="size-3.5 text-primary" aria-hidden />
        <span>Suggestions:</span>
      </div>
      {SUGGESTIONS.map((text) => (
        <Button
          key={text}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(text)}
          className="h-7 text-xs rounded-full border-muted-foreground/30 px-3 hover:border-primary hover:text-primary transition-colors text-left"
        >
          {text}
        </Button>
      ))}
    </div>
  );
}

