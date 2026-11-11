"use client";

import { ChevronDown, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { usePersona } from "@/components/shell/PersonaProvider";

/** Demo sign-in: pick which seeded person this browser acts as. */
export function PersonaSwitcher() {
  const { status, personas, current, switchTo, reload } = usePersona();

  if (status === "loading") return <Skeleton className="h-8 w-36" />;
  if (status === "error") {
    return (
      <Button variant="outline" onClick={reload}>
        Retry loading people
      </Button>
    );
  }

  async function choose(profileId: string) {
    if (profileId === current?.id) return;
    const ok = await switchTo(profileId);
    const person = personas.find((p) => p.id === profileId);
    if (ok && person) toast.success(`You are now ${person.name}.`);
    else toast.error("Could not switch person. Please retry.");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" aria-label="Switch demo person" />}
      >
        <UserRound aria-hidden />
        <span className="max-w-32 truncate">{current ? current.name : "Choose a person"}</span>
        <ChevronDown aria-hidden className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Act as a demo person</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={current?.id ?? ""} onValueChange={choose}>
            {personas.map((person) => (
              <DropdownMenuRadioItem key={person.id} value={person.id} closeOnClick>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{person.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{person.blurb}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
