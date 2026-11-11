"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { PersonaSwitcher } from "@/components/shell/PersonaSwitcher";
import { usePersona, type Persona } from "@/components/shell/PersonaProvider";

type NavItem = { href: string; label: string; roles: Persona["role"][] };

// Only routes that exist are listed; each feature adds its own entry.
const NAV: NavItem[] = [{ href: "/", label: "Events", roles: ["attendee", "organiser"] }];

export function AppHeader() {
  const pathname = usePathname();
  const { current } = usePersona();
  const items = NAV.filter((item) => !current || item.roles.includes(current.role));

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          EventsMate
        </Link>

        <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                  active && "bg-muted font-medium text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <Badge
          variant="outline"
          className="hidden sm:inline-flex"
          title="Payments run in the PayPal sandbox. No real money moves."
        >
          Sandbox
        </Badge>
        <PersonaSwitcher />
      </div>
    </header>
  );
}
