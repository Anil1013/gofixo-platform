# Gofixo Customer & Partner Fairness Plan

Status: implementation specification for the `feature/customer-partner-fairness` branch.
Scope: Android customer/partner app, backend API, and web admin. Ride pricing and ride subscriptions must remain isolated from home-service pricing.

## Product principles

1. No hidden charges: show the service unit, included scope, exclusions, estimated duration, taxes/fees and total before confirmation.
2. No unapproved extras: a partner must submit an itemised change quote and receive customer approval before doing extra work.
3. Fair partner earnings: show gross amount, platform commission, approved expenses/adjustments and net payout before accepting a job.
4. Safety and proof: verified partner identity, booking OTP, job milestones and evidence where appropriate.
5. Consistency: server-side pricing is authoritative; never trust a price sent by a mobile client.
6. Admin control: prices, commission, service availability, cancellation rules and guarantee terms are versioned and configurable by city/service. Never hardcode live commercial rates in Flutter.

## Current repository constraints discovered

- `services/catalog.js` currently has one base fare per home-service category.
- `POST /bookings` calculates that base fare on the server and reserves the same amount from the customer's Gofixo wallet.
- `POST /bookings/:id/confirm-payment` treats the booking fare as locked, captures the wallet reserve and currently applies one `GOFIXO_COMMISSION_PERCENT` to every home service.
- Therefore partner quotations, per-category commissions and variable-quantity pricing must not be switched on only in the UI. They need a transactional backend and wallet-ledger change first.
- Existing ride fare calculation is separate and must not be changed by home-service work.

## Recommended service pricing model

Each service definition should have:
- stable service key and display name;
- pricing mode: fixed package, per unit, per kg, per item, per hour, per visit, per sq ft, or inspection + approved quote;
- base/minimum charge and quantity step;
- included scope and exclusions;
- estimated duration range;
- optional add-ons and material/parts rules;
- city/zone price overrides and effective dates;
- commission rule and partner minimum payout;
- cancellation, revisit and guarantee policy;
- active state and catalog version.

Illustrative customer flows:
- Cleaning: customer selects room, kitchen, bathroom or full-home package; BHK/room/bathroom quantities; normal/deep clean; add-ons. Show exactly what is included.
- AC: select split/window, brand, unit count and symptom/service. Inspection/visit fee is shown upfront. Technician submits diagnosis with labour and parts line items; customer approves before repair.
- Laundry: select wash-fold, wash-iron, ironing or dry-clean; show per-kg/per-piece unit, minimum order, estimated weight and final weighed quantity. Any price adjustment requires customer confirmation.
- Caregiving: select companionship/personal-care scope, 2/4/8/12-hour or recurring shift, day/night and caregiver requirements. Nursing/clinical work must be a separately credentialed service.
- Repairs (electrician/plumber/carpenter/appliances/RO): transparent visit/inspection fee and fixed-price common tasks; otherwise itemised diagnosis quote before repair.
- Painting/pest control/gardening/movers: quantity/area/BHK/visit/hour inputs and inspection-based quotes when scope cannot be measured reliably.

Do not publish the example prices from planning conversations as final tariffs. Validate each city/service rate against provider costs, competitor ranges, travel, materials, taxes and target partner take-home before activation.

## Quotation and wallet transaction rules

1. Booking stores a price snapshot: catalog version, selected options, quantities, included scope, base amount, fees and estimate.
2. Customer wallet reserve is created atomically for the displayed amount; booking request cannot be created if reserve fails.
3. Partner can submit a quote only before work starts. Quote has line items, labour, materials, reason, photos if relevant, expiry and total delta.
4. Customer sees old total, new total, itemised difference and approve/decline controls.
5. Approval atomically reserves only the additional amount (or releases excess if revised total is lower). Decline means partner must complete the originally booked scope or cancel under the published policy; no extra work is chargeable.
6. Work start requires customer OTP after the final approved scope is locked.
7. Completion captures the final approved amount once. Cancellation/refund releases the correct reserved amount exactly once. All operations use database transactions, row locks and idempotency keys.
8. Never accept a final amount typed by the partner as authority to overwrite the locked approved amount.

## Recommended commission and payout policy

- Use category-specific commission configured in admin, not a single global percentage.
- Minimum Gofixo commission: 20% on approved home-service labour/visit charges across all categories; partner share is at most 80%. This is a proposed commercial rule and must be shown transparently before partner acceptance and reviewed for viable partner earnings.
- Display commission and net earning to partner before acceptance.
- Do not charge commission on customer-approved pass-through material costs unless the policy explicitly says so and customer sees it.
- Home-service customers prepay through the Gofixo wallet. Reserve funds at booking, capture only after customer-verified completion, and release/refund on eligible cancellation. Keep ride payment flows separate.
- Minimum platform commission is 20% of approved labour/visit charges in every home-service category; approved actual-cost materials are passed through at 0% commission. Show partner net earnings before acceptance.
- Create exactly one idempotent partner payout per completed home-service booking. Target payout within 4 hours after completion verification and quality checks, to a verified partner UPI ID/bank account. Admin may approve, hold or retry; record UTR/provider reference and never mark paid without confirmed transfer.
- Hold payouts during disputes, refund requests, mismatched completion evidence or suspected off-platform booking bypass. Cash/off-platform settlement is disabled for home services by default; exceptions require documented admin review.
- Add payout ledger entries, settlement status, failure reason and reconciliation view.

## Fair cancellations and reassignment

- Unaccepted requests expire and are automatically offered to the next eligible nearby partner; notify the customer and never leave a request silently stuck.
- Partner cancellation before job start triggers immediate customer notification, wallet release and automatic reassignment where possible.
- Customer cancellation rules are shown before booking. Any travel/cancellation compensation is allowed only when the partner has accepted and verifiably started travel/arrived; disclose the amount/cap before confirmation.
- Genuine emergencies and platform/provider faults get an appeal path. Do not penalise partners for customer no-shows, unsafe addresses or platform failures.
- Once OTP job start occurs, cancellation becomes a support-assisted stop-work/refund workflow, not a normal pre-start cancellation.

## Trust, quality and retention

- KYC and skill-specific verification; enhanced checks for senior/disability care and childcare.
- OTP check-in/start and completion; before/after photos for cleaning/repair only with customer consent and privacy-safe framing.
- Two-way ratings with structured tags; flag abusive reviews and provide an appeal process. Never automatically punish a partner based on one low rating.
- Service-specific workmanship revisit/guarantee terms with exclusions, evidence and a complaint window. Do not promise a blanket warranty for consumables, misuse or unrelated faults.
- Masked calling/chat, emergency contact/SOS, incident reporting and audit logs.
- Partner availability, service radius, leave/weekly off and category skills controls.
- Customer rebooking, saved addresses, favourites, service reminders and referral credits with fraud controls.
- Partner rewards based on quality, punctuality, low verified complaints and reliability—not raw booking count alone.

## Admin modules

1. Service catalogue and realistic service imagery.
2. Pricing builder with unit, quantity rules, packages, add-ons, duration and city overrides.
3. Commission and minimum partner earning settings.
4. Quote approvals, wallet reserves/releases/captures and audit history.
5. Cancellation, reassignment and refund controls.
6. Partner KYC, skills, availability, ratings, appeals and rewards.
7. Payout reconciliation and platform revenue.
8. Service-level performance: conversion, completion, repeat booking, complaints, partner earnings and margin.

## Delivery sequence and acceptance criteria

### Phase 1 — safe foundation
- Add schema migration strategy and tests for service price snapshots, price versions and category commission.
- Keep ride pricing and ride subscriptions unchanged.
- Build a pure server-side pricing calculator with unit/quantity validation and rounding rules.
- Add admin-managed service definitions; existing services remain available during migration.
- Tests prove client-submitted prices cannot override server calculations.

### Phase 2 — booking scope and quote workflow
- Persist selected options, quantity, duration estimate and included scope.
- Add partner quote / customer approve-decline endpoints with transactional wallet delta reserve/release.
- Enforce quote expiry, no quote after OTP start, idempotency and audit trail.
- Add customer and partner UI for itemised quote and approval.

### Phase 3 — partner fairness and customer trust
- Category commission and partner net earning preview.
- Cancellation/reassignment compensation policy with verified travel state.
- Service-specific guarantee, complaint and revisit workflow.
- Two-way ratings, appeals, KYC/skill checks and partner rewards.

### Phase 4 — launch readiness
- Admin reports and payout reconciliation.
- Android customer and partner regression tests; admin/backend tests.
- Verify booking lifecycle, wallet reserve/capture/release, refunds, cash/UPI reconciliation and ride isolation.
- Deploy only after CI is green and a staging end-to-end test passes.

## Required tests

- Per-unit and package price calculation, min/max quantity, invalid units, city overrides and effective dates.
- Price snapshot remains stable after admin changes a later price.
- Quote approve/decline/expiry, concurrent approval taps, wallet insufficient balance and duplicate requests.
- Customer cancellation, partner cancellation, timeout, reassignment and exactly-once wallet release.
- Category commission calculation and partner payout reconciliation.
- Existing ride fares, ride subscriptions and ride booking lifecycle remain unchanged.
