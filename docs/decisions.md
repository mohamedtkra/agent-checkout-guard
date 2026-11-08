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

## 001: Prototype behavior for open PRD questions

- **Date:** 2026-11-08
- **Status:** Proposed

**Context:** The first prototype needed working behavior for questions the PRD leaves open.

**Decision:** The budget is one overall limit. A purchase waiting for approval holds its amount against the budget, and rules are checked again when it is approved. The agent waits indefinitely for a decision. Revoking access cancels waiting purchases and invalidates the test token. Approval happens on a mobile-friendly screen, with no push notification. The app is a dependency-free Node server that keeps data in memory for a single customer.

**Alternatives considered:** Per-purchase or per-period budgets, approval timeouts, and a database were left out to keep the prototype small until the PRD questions are settled.

**Consequences:** The prototype is quick to run and change, but data is lost on restart and there are no customer accounts. These choices should be revisited as the PRD questions are answered.
