# TODO

Build in this order, one feature at a time. Each item ends with its gate: the thing that must
be shown working against the real PayPal sandbox before the next item starts.

- [x] **0. UI pattern approved** (D18, D19).
- [x] **1. Foundation.** New schema and relative-date seed (events, tiers, personas), persona
      switcher, app shell. Gate: switching persona changes what the shell shows; `/api/events` returns seeded tiers.
- [x] **2. F1 Events and tiers.** List and event page. Gate: availability per tier matches the database.
- [x] **3. F2 Buy a ticket.** (built and verified up to PayPal order creation; gate needs the user to approve a sandbox payment) Gate: a sandbox buyer pays and a verified ticket appears in "My tickets".
- [x] **4. F3 Standby hold.** (built and verified up to PayPal order creation; gate needs the user to approve a sandbox hold, then cancel it) Gate: an authorization exists in PayPal, shows as a hold, and cancelling voids it.
- [x] **5. F4 Release a seat** with a rule-based refund preview (built after item 8, decision D32). Gate: release, take back, and cutoff return all work.
- [ ] **6. F5 Settlement, rule-based matching first.** Gate: release triggers capture, refund and ticket transfer, with PayPal references; a forced capture failure refunds nobody.
- [ ] **7. F9 Action log.** Gate: every step of item 6 is visible with its reason and reference.
- [x] **8. F6 Policy reader.** (built before item 5, decision D32) Gate: a pasted policy becomes a confirmed rule and drives the refund preview.
- [ ] **9. F5 Agent matching.** Gate: a multi-request, multi-tier case is allocated better than first-come, and an invalid model proposal is rejected by code.
- [ ] **10. F7 Command bar.** Gate: three typed commands each produce the correct confirm card.
- [ ] **11. F8 Organiser dashboard** (AG Grid, Bryntum). Gate: numbers match the database after a settlement.
- [ ] **12. F10 Webhooks + deploy on Render.** Gate: a signed sandbox webhook is verified and reconciles state on the hosted URL.
- [ ] **13. Submission.** README run instructions, hosted demo, video under 3 minutes, Devpost text.

If time runs short, cut from the bottom of 8-12, never from 3-7 or 13.
