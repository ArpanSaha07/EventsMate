-- EventsMate demo catalog. All events are FICTIONAL, EventsMate-native demo listings.
-- Times are America/Toronto (EST, UTC-05:00 in November). Demo weekend: Sat Nov 14 – Sun Nov 15, 2026.
-- Safe to re-run: clears unsold demo data first. If tickets already exist, delete
-- tickets and checkouts manually before re-seeding.

delete from events where id not in (select event_id from tickets);

insert into events (title, description, category, tags, venue, city, starts_at, ends_at, price_cents, capacity) values
('Build Your First AI Agent (Hands-on)',
 'Demo event. A guided workshop: wire a tool-calling agent to a real API and ship a small working assistant by the end.',
 'Workshop', '{ai,agents,hands-on,workshop,developers}',
 'Atelier Mile End (demo venue)', 'Montréal',
 '2026-11-14 10:00:00-05', '2026-11-14 12:30:00-05', 2500, 60),

('Prompt to Product: LLM Prototyping Lab',
 'Demo event. Bring a laptop. Small teams turn an idea into a working LLM prototype with structured outputs.',
 'Workshop', '{ai,llm,hands-on,workshop,prototyping}',
 'Studio Saint-Laurent (demo venue)', 'Montréal',
 '2026-11-14 14:00:00-05', '2026-11-14 17:00:00-05', 3000, 50),

('RAG From Scratch: Hands-on Clinic',
 'Demo event. Build retrieval pipelines step by step and learn where they break. Overlaps the agent workshop on purpose.',
 'Workshop', '{ai,rag,hands-on,workshop,data}',
 'Labo Griffintown (demo venue)', 'Montréal',
 '2026-11-14 11:00:00-05', '2026-11-14 13:30:00-05', 2000, 40),

('Montréal AI Founders Meetup',
 'Demo event. Short founder talks followed by open networking for people building AI startups.',
 'Meetup', '{ai,startup,networking,founders}',
 'Le Salon Plateau (demo venue)', 'Montréal',
 '2026-11-14 18:30:00-05', '2026-11-14 21:00:00-05', 1500, 120),

('Sunday Hack Night: Agents & Payments',
 'Demo event. An evening build sprint focused on agentic commerce. Pizza included.',
 'Hack night', '{ai,agents,hackathon,hands-on,payments}',
 'Garage Rosemont (demo venue)', 'Montréal',
 '2026-11-15 17:00:00-05', '2026-11-15 21:30:00-05', 1000, 80),

('Applied Computer Vision Workshop',
 'Demo event. Train and evaluate a small vision model on your own images. Premium, small-group format.',
 'Workshop', '{ai,vision,hands-on,workshop,ml}',
 'Atelier Mile End (demo venue)', 'Montréal',
 '2026-11-15 10:00:00-05', '2026-11-15 13:00:00-05', 4500, 24),

('Design Systems for AI Interfaces',
 'Demo event. A design session on patterns for chat, approval and agent-activity UI.',
 'Design session', '{design,ux,ai,product}',
 'Studio Saint-Laurent (demo venue)', 'Montréal',
 '2026-11-15 13:30:00-05', '2026-11-15 15:30:00-05', 2000, 45),

('Startup Pitch Practice Night',
 'Demo event. Practise a three-minute pitch and get structured feedback from peers.',
 'Meetup', '{startup,pitching,networking,founders}',
 'Le Salon Plateau (demo venue)', 'Montréal',
 '2026-11-13 18:00:00-05', '2026-11-13 20:30:00-05', 1200, 70),

('Open Data Community Meetup (Free)',
 'Demo event. Free community meetup on civic and open data projects.',
 'Meetup', '{data,community,networking,free}',
 'Bibliothèque Centre-Ville (demo venue)', 'Montréal',
 '2026-11-15 11:00:00-05', '2026-11-15 12:30:00-05', 0, 100),

('MLOps in Practice: Deploying Models',
 'Demo event. Weeknight hands-on session on packaging, deploying and monitoring models.',
 'Workshop', '{ai,mlops,hands-on,workshop,developers}',
 'Labo Griffintown (demo venue)', 'Montréal',
 '2026-11-18 18:00:00-05', '2026-11-18 20:30:00-05', 3500, 40),

('Toronto AI Builders Night',
 'Demo event. Lightning demos from people shipping AI products. Different city, for location filtering.',
 'Meetup', '{ai,startup,networking,demos}',
 'Queen West Loft (demo venue)', 'Toronto',
 '2026-11-14 18:00:00-05', '2026-11-14 21:00:00-05', 2000, 150),

('Intro to Fine-tuning Small Models',
 'Demo event. Limited seats. Fine-tune a compact model on a laptop-sized dataset.',
 'Workshop', '{ai,fine-tuning,hands-on,workshop,ml}',
 'Garage Rosemont (demo venue)', 'Montréal',
 '2026-11-21 10:00:00-05', '2026-11-21 13:00:00-05', 4000, 30);
