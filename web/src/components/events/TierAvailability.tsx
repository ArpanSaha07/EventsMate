import { Badge } from "@/components/ui/badge";
import { seatsLeft } from "@/lib/rules";

/** "Sold out", "3 left" when scarce, otherwise "Available". */
export function TierAvailability({ tier }: { tier: { capacity: number; sold_count: number } }) {
  const left = seatsLeft(tier);
  if (left === 0) return <Badge variant="destructive">Sold out</Badge>;
  if (left <= 5) {
    return (
      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
        {left} left
      </Badge>
    );
  }
  return <Badge variant="secondary">Available</Badge>;
}
