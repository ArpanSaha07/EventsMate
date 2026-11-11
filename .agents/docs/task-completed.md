# Completed tasks

| Date | Task | Notes |
|---|---|---|
| 2026-11-10 | Scope, decisions, architecture, skills, README | D1-D23 recorded |
| 2026-11-10 | TODO 0: UI pattern approved | Workspace + agent bar, calm light |
| 2026-11-10 | TODO 1: Foundation | Schema and seed applied; persona switching and /api/events verified in browser and by API |
| 2026-11-10 | TODO 2: F1 Events and tiers | List and event page verified in browser |
| 2026-11-10 | TODO 3: F2 Buy a ticket, built | Sandbox order created with server-computed total; rejection paths verified; capture awaits a human PayPal approval |
| 2026-11-11 | TODO 5: F4 Release a seat | Gate met: release, take back and cutoff return verified against the real database (API) and release / take back in the browser. Also D43 (one hand-written rule) and D44 (resale always pays; 0% clauses removed) |
| 2026-11-11 | TODO 8: F6 Policy reader | Built before item 5 (D32). Gate met in the browser: a pasted policy was read, confirmed and drives the refund preview on the event page; an unreadable policy is rejected with reasons |
| 2026-11-10 | TODO 4: F3 Standby hold, built | Sandbox AUTHORIZE order created; rejection paths verified; authorize and void await a human PayPal approval |
| 2026-11-11 | Plan with AI chat fixed (D49) | The model now picks from the live catalog and code splits results into available and sold out. Verified by API and in the browser: a named sold-out event, sold-out-only, all events, and a follow-up question. Buying and joining standby from the chat were not re-exercised |
