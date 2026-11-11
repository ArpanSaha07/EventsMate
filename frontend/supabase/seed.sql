-- EventsMate demo seed. Everything here is FICTIONAL demo data.
--
-- DESTRUCTIVE: wipes all people, events, orders and tickets, then reseeds.
-- Dates are relative to "today" in San Francisco, so events are always upcoming
-- and always inside PayPal's 29-day authorization window. Re-run any time
-- (`npm run db:seed`) to reset the demo.
--
-- Seeded "sold" seats belong to a hidden filler profile and have no PayPal
-- capture, so they can never be released or refunded. The holder personas buy
-- the last seats for real in the sandbox; those tickets are the releasable ones.

-- One DO block, so the whole seed is a single statement (the Supabase CLI's
-- `db query` runs one statement) and a single transaction.
do $seed$
declare
  today date := (now() at time zone 'America/Los_Angeles')::date;
begin

truncate table tickets, orders, ticket_tiers, events, profiles cascade;

-- People ---------------------------------------------------------------------

insert into profiles (slug, name, role, blurb, switchable, sort_order) values
  ('priya',  'Priya Raman',   'organiser', 'Organiser, Bay Builders Collective', true, 1),
  ('maya',   'Maya Chen',     'attendee',  'Ticket holder',                      true, 2),
  ('daniel', 'Daniel Okafor', 'attendee',  'Ticket holder',                      true, 3),
  ('sofia',  'Sofia Alvarez', 'attendee',  'Ticket holder',                      true, 4),
  ('liam',   'Liam Turner',   'attendee',  'Fan looking for a seat',             true, 5),
  ('aisha',  'Aisha Khan',    'attendee',  'Fan looking for a seat',             true, 6),
  ('noah',   'Noah Kim',      'attendee',  'Fan looking for a seat',             true, 7),
  ('others', 'Other attendees', 'attendee', 'Seeded filler ticket owners',       false, 99);

-- Events ---------------------------------------------------------------------

insert into events
  (organiser_id, title, description, category, venue, city, starts_at, ends_at, refund_policy_text)
select p.id, e.title, e.description, e.category, e.venue, 'San Francisco',
       ((today + e.day_offset) + e.start_time) at time zone 'America/Los_Angeles',
       ((today + e.day_offset) + e.end_time) at time zone 'America/Los_Angeles',
       e.refund_policy_text
from profiles p,
(values
  ('Hands-on RAG Workshop',
   'Demo event. Build a retrieval pipeline step by step and learn where it breaks. Bring a laptop.',
   'Workshop', 'Mission Workshop Hall (demo venue)', 6, time '18:00', time '21:00',
   'If your released seat is resold, you get a full refund minus a $2 processing fee.'),
  ('Build Your First AI Agent',
   'Demo event. Wire a tool-calling agent to a real API and leave with a small working assistant.',
   'Workshop', 'SoMa Makers Loft (demo venue)', 8, time '10:00', time '13:00',
   'Resold seats are refunded at 90% of the ticket price. Within 24 hours of the start time the refund is 75%.'),
  ('SF AI Founders Mixer',
   'Demo event. Short founder talks, then open networking for people building AI startups.',
   'Meetup', 'Hayes Valley Commons (demo venue)', 4, time '18:30', time '21:00',
   'Full refund when your seat is resold. No fees.'),
  ('Design Sprint for AI Products',
   'Demo event. A one-day sprint: frame a problem, prototype an AI feature, test it with users.',
   'Workshop', 'Dogpatch Studio (demo venue)', 10, time '09:30', time '16:00',
   'We refund 85% of what you paid if your seat is resold. VIP seats are refunded at 80% because catering is pre-ordered.'),
  ('Agents & Payments Hack Night',
   'Demo event. An evening build sprint on agentic commerce. Pizza included.',
   'Hack night', 'Potrero Garage (demo venue)', 12, time '17:00', time '22:00',
   'Resold seats get a full refund minus a $1 fee.'),
  ('Applied Computer Vision Clinic',
   'Demo event. Train and evaluate a small vision model on your own images. Small-group format.',
   'Workshop', 'Mission Workshop Hall (demo venue)', 15, time '10:00', time '13:00',
   'Half of the ticket price is refunded when a released seat is resold.')
) as e(title, description, category, venue, day_offset, start_time, end_time, refund_policy_text)
where p.slug = 'priya';

-- Tiers ----------------------------------------------------------------------
-- Tiers that are nearly sold out leave 1-3 seats for the holder personas to buy.

insert into ticket_tiers (event_id, name, description, price_cents, capacity, sold_count, sort_order)
select ev.id, t.name, t.description, t.price_cents, t.capacity, t.sold_count, t.sort_order
from events ev
join (values
  ('Hands-on RAG Workshop',          'General', 'Workshop seat',                     3500, 40, 37, 1),
  ('Hands-on RAG Workshop',          'VIP',     'Front tables and a 1:1 review',     6000, 10,  8, 2),
  ('Build Your First AI Agent',      'General', 'Workshop seat',                     3000, 50, 48, 1),
  ('Build Your First AI Agent',      'VIP',     'Front row and office hours after',  5500,  8,  7, 2),
  ('SF AI Founders Mixer',           'General', 'Entry and one drink',               2000, 120, 64, 1),
  ('Design Sprint for AI Products',  'General', 'Sprint seat and lunch',             4500, 30, 12, 1),
  ('Design Sprint for AI Products',  'VIP',     'Sprint seat, lunch and mentor table', 8000, 6,  5, 2),
  ('Agents & Payments Hack Night',   'General', 'Entry and pizza',                   1500, 80, 78, 1),
  ('Applied Computer Vision Clinic', 'General', 'Clinic seat',                       5000, 24,  9, 1)
) as t(event_title, name, description, price_cents, capacity, sold_count, sort_order)
  on t.event_title = ev.title;

-- Filler tickets for the seeded sold counts -----------------------------------

insert into tickets (event_id, tier_id, owner_id, ticket_number, unit_price_cents)
select tt.event_id, tt.id, o.id,
       'EM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
       tt.price_cents
from ticket_tiers tt
cross join lateral generate_series(1, tt.sold_count)
cross join (select id from profiles where slug = 'others') o;

end
$seed$;
