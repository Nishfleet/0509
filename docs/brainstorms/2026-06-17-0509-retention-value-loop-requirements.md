---
date: 2026-06-17
topic: 0509-retention-value-loop
---

# 0509 Retention Value Loop

## Summary

Five to Nine should make its retained value loop visible inside the product: add one competitor, run the first sweep, show whether the product looked, show what changed, attach proof, and keep the next review moment obvious.

---

## Problem Frame

The current product already has watchlists, proof captures, digests, and delivery setup. The retention gap is that a customer can miss the value if nothing dramatic changed today. The product needs to show the "we looked" moment as clearly as the "we found something" moment, without inventing unproven claims or sending new outbound messages before the in-app truth is clear.

---

## Key Decisions

- **Use the existing proof loop as the retention loop.** 0509's durable promise is proof-backed competitor monitoring, not generic growth advice.
- **Start with visible product truth.** The first shipped slice should use existing onboarding and dashboard data before adding outbound lifecycle automation.
- **Treat quiet checks as value.** A retained monitoring product should show that silence can mean the account was checked, not that nothing happened.

---

## Actors

- A1. Growth owner: wants to know what competitors changed without checking ads manually.
- A2. Agency/team operator: needs a retained proof trail for client or internal reviews.
- A3. Five to Nine monitoring system: checks watched competitors, captures proof, creates events, and feeds digests.

---

## Requirements

**Expectation setting**

- R1. Onboarding must explain what happens after a first competitor is added.
- R2. Copy must avoid guaranteed-growth, instant-result, or broad delivery claims that are not backed by current product proof.

**First value**

- R3. The first competitor setup must continue to create a watchlist and queue the first scan when the user has monitoring capacity.
- R4. Users without monitoring capacity must see a truthful paid-plan path instead of a broken setup promise.

**Recurring value**

- R5. The dashboard must show the retained loop as looked, changed, proved, and delivered using existing account data.
- R6. A quiet account must still show the next scan or recent checked volume so the product does not appear idle.
- R7. The next useful action must stay visible when a user lacks a watchlist, digest, proof capture, Slack proof, or billing capacity.

---

## Key Flows

- F1. First competitor setup
  - **Trigger:** A new owner reaches onboarding.
  - **Actors:** A1, A3
  - **Steps:** The owner enters a competitor website, searches or creates a watchlist, and 0509 queues the first scan.
  - **Outcome:** The owner lands in retained monitoring with a concrete competitor under watch.
  - **Covered by:** R1, R3, R4

- F2. Retained value review
  - **Trigger:** A returning user opens the dashboard.
  - **Actors:** A1, A2, A3
  - **Steps:** The dashboard shows watched competitors, recent checked volume or next scan, proof status, digest delivery, and unresolved setup gaps.
  - **Outcome:** The user can tell whether 0509 looked, found change, attached proof, and delivered the result.
  - **Covered by:** R5, R6, R7

---

## Acceptance Examples

- AE1. Covers R1 and R3. Given a user has monitoring capacity, when they view onboarding, then they see that the first competitor creates a watchlist and starts a first sweep.
- AE2. Covers R4. Given a user has no watchlist capacity, when they view onboarding, then they see pricing copy and no enabled "create watchlist" path.
- AE3. Covers R5 and R6. Given a returning user has watchlists but no recent change events, when they view the dashboard, then they see that 0509 is watching or when the next sweep runs.
- AE4. Covers R5 and R7. Given a returning user has proof captures or sent digests, when they view the dashboard, then those proof and delivery moments are summarized as retained value.

---

## Success Criteria

- The first visible slice ships without new tables, provider setup, or outbound lifecycle automation.
- The dashboard can be scanned for the account's current retained-value state in one pass.
- Existing onboarding and app rebuild tests cover the new customer-facing copy.

---

## Scope Boundaries

### Deferred for later

- Automated day 1, day 3, day 6, and day 10 lifecycle emails or Slack nudges.
- Testimonial or review asks after repeated proof-backed value moments.
- Churn analytics, account-health scoring, and customer-success operator views.
- In-app timeline history of every lifecycle touchpoint.

### Outside this product's identity

- Claims that 0509 guarantees revenue growth.
- Generic CRM-style nurture sequences that are not tied to competitor proof.
- Customer WhatsApp delivery claims before provider setup, opt-in, webhook readiness, and delivered proof are verified.

---

## Sources / Research

- Kai Stone retention playbook video, published 2026-06-13, used as product-retention inspiration: set expectations before payment, reset them during onboarding, make value visible, and use touchpoints that feel personal.
- Existing 0509 surfaces: `app/routes/app.onboard.tsx`, `app/routes/app.dashboard.tsx`, `app/routes/app.digests.tsx`, `app/routes/app.sources.tsx`, `docs/docs.tsx`, and `MEMORY.md`.
