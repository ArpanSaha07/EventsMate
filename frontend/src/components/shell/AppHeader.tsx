"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { PersonaSwitcher } from "@/components/shell/PersonaSwitcher";
import { usePersona, type Persona } from "@/components/shell/PersonaProvider";

type NavItem = { href: string; label: string; roles: Persona["role"][] };

// Only routes that exist are listed; each feature adds its own entry.
const NAV: NavItem[] = [
  { href: "/", label: "Events", roles: ["attendee", "organiser"] },
  { href: "/plan", label: "Plan with AI", roles: ["attendee", "organiser"] },
  { href: "/tickets", label: "My tickets", roles: ["attendee", "organiser"] },
  { href: "/standby", label: "Standby", roles: ["attendee", "organiser"] },
  { href: "/manage", label: "My events", roles: ["organiser"] },
];

const LINK_CLASS =
  "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground";

function isActive(item: NavItem, pathname: string): boolean {
  return item.href === "/"
    ? pathname === "/" || pathname.startsWith("/events")
    : pathname.startsWith(item.href);
}

function useNavItems(): NavItem[] {
  const { current } = usePersona();
  return NAV.filter((item) => !current || item.roles.includes(current.role));
}

/** Links with the current page highlighted. Reads the URL, so it renders behind a boundary. */
function ActiveNavLinks() {
  const pathname = usePathname();
  return useNavItems().map((item) => {
    const active = isActive(item, pathname);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(LINK_CLASS, active && "bg-muted font-medium text-foreground")}
      >
        {item.label}
      </Link>
    );
  });
}

/** The same links without a highlight: what the static shell shows before the URL is known. */
function PlainNavLinks() {
  return useNavItems().map((item) => (
    <Link key={item.href} href={item.href} className={LINK_CLASS}>
      {item.label}
    </Link>
  ));
}

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:gap-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          EventsMate
        </Link>

        <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <Suspense fallback={<PlainNavLinks />}>
            <ActiveNavLinks />
          </Suspense>
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
