# Decisions

A running log of significant project decisions. Add new entries at the top, and supersede old entries rather than rewriting them.

## Template

```markdown
## NNN: Decision title

- **Date:** YYYY-MM-DD
- **Status:** Proposed | Accepted | Superseded by NNN

**Context:** What prompted this decision?

**Decision:** What did we choose?

**Alternatives considered:** What else was on the table, and why was it rejected?

**Consequences:** What gets easier or harder as a result?
```

## Log

## 003: Block mismatches, auto-pause on flagged charges, and model refunds on card disputes

- **Date:** 2026-11-08
- **Status:** Accepted

**Context:** Customers need protection at three points: before a charge, when a charge goes through that should not have, and after a purchase goes wrong.

**Decision:** The guard blocks rather than warns. Before any charge, the server re-checks the final amount, merchant, and item against the rules and against what was cleared or approved. Any mismatch or duplicate is blocked and logged with its reason. The agent pauses automatically on any flagged charge, and only the customer can resume it. Refund requests mirror a card dispute process: Submitted, Under review, Merchant contacted, then Refunded or Declined, with a date for each step and an expected time to resolve.

**Alternatives considered:** Warning the customer and letting the charge continue would leave money at risk until they responded. Flagging a charge without pausing would let the agent keep spending while something is wrong. A simple refund button would give customers no visibility into progress.

**Consequences:** A harmless change, such as a lower final price, is also blocked, so false blocks need watching. One flagged charge stops all agent purchases until the customer acts. In the prototype, processing is mock, stages are advanced by hand, and resolution estimates are placeholders.

## 001: Prototype behavior for open PRD questions

- **Date:** 2026-11-08
- **Status:** Proposed

**Context:** The first prototype needed working behavior for questions the PRD leaves open.

**Decision:** The budget is one overall limit. A purchase waiting for approval holds its amount against the budget, and rules are checked again when it is approved. The agent waits indefinitely for a decision. Revoking access cancels waiting purchases and invalidates the test token. Approval happens on a mobile-friendly screen, with no push notification. The app is a dependency-free Node server that keeps data in memory for a single customer.

**Alternatives considered:** Per-purchase or per-period budgets, approval timeouts, and a database were left out to keep the prototype small until the PRD questions are settled.

**Consequences:** The prototype is quick to run and change, but data is lost on restart and there are no customer accounts. These choices should be revisited as the PRD questions are answered.
