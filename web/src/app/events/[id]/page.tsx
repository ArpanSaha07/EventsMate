import { Suspense } from "react";
import { EventDetail, EventDetailSkeleton } from "@/components/events/EventDetail";

export default function EventPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      {/* The event id is request-time data, so the detail renders behind a boundary. */}
      <Suspense fallback={<EventDetailSkeleton />}>
        <EventDetail />
      </Suspense>
    </main>
  );
}
