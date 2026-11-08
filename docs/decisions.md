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

## 006: Merchants choose agent companies, and customers can allow by category

- **Date:** 2026-11-08
- **Status:** Accepted

**Context:** Merchants should have a say in which agent companies can buy from them, and customers should be able to think in merchant categories.

**Decision:** Each merchant keeps a list of the agent companies it accepts. The guard blocks a purchase if the merchant does not accept the agent's company, including when the merchant withdraws acceptance after a purchase was cleared or held. Customers can allow a whole category or individual merchants.

**Alternatives considered:** Showing merchant partners without enforcing them would not give merchants real control. Grouping merchants by category for display only would not let customers set a whole category at once.

**Consequences:** The product now has a merchant side, which the prototype represents with one mock settings screen and no merchant accounts. Allowing a category currently selects its merchants, so a merchant added to a category later would not be allowed automatically.

## 005: Per-agent scoped tokens with step-up verification and signed consent

- **Date:** 2026-11-08
- **Status:** Accepted

**Context:** Customers need to connect more than one agent, control each one separately, and have proof of what they allowed. One shared token per customer could not do that.

**Decision:** Each connected agent gets its own test card token, valid only within its consent. Connecting an agent or editing its permissions requires a step-up one-time code, then a consent screen showing exactly what the agent may do. The consent is stored as a signed record. The guard checks the token, the signed consent, and the customer's rules on every purchase. Revoking one agent does not affect the others. The design is modeled on the Agentic Commerce Protocol, whose delegated payment tokens are limited by amount and expiry, and on AP2, whose signed Intent Mandate records what a person allowed an agent to do. Users, sessions, connections, consents, tokens, and the audit log are stored in SQLite. This supersedes the parts of decision 001 that kept data in memory and avoided dependencies.

**Alternatives considered:** A single account-level token would make per-agent revocation and limits impossible. Consent stored as plain settings could not show that a record is unchanged. Implementing either protocol in full is more than the prototype needs, since it has no real payment network to talk to.

**Consequences:** The prototype follows the ideas of these protocols but does not conform to or interoperate with either. Consents are signed by a key held on the server, on the customer's behalf after step-up, and not by a key on the customer's device. One-time codes are shown on screen, so sign-in proves nothing about identity and must stay demo-only. A flagged charge still pauses all of a customer's agents. Purchases in progress are canceled if the server restarts, because the mock agent does not survive it.

## 004: Allow lower final prices

- **Date:** 2026-11-08
- **Status:** Accepted

**Context:** Decision 003 blocked any change to the final price, including a lower one. Its consequences noted that this would block harmless changes.

**Decision:** A lower final price is allowed, charged at the lower price, and logged. A higher final price is still blocked, along with a different merchant or item and a duplicate purchase. This supersedes the part of decision 003 that blocked lower prices.

**Alternatives considered:** Keeping the block on every price change would stop purchases that benefit the customer. Asking the customer to approve a lower price would add an interruption with no protective value.

**Consequences:** A lower price benefits the customer, so it is logged rather than blocked. A final price that cannot be read, such as zero or a negative amount, is still blocked rather than treated as lower.

## 003: Block mismatches, auto-pause on flagged charges, and model refunds on card disputes

- **Date:** 2026-11-08
- **Status:** Accepted, partly superseded by 004

**Context:** Customers need protection at three points: before a charge, when a charge goes through that should not have, and after a purchase goes wrong.

**Decision:** The guard blocks rather than warns. Before any charge, the server re-checks the final amount, merchant, and item against the rules and against what was cleared or approved. Any mismatch or duplicate is blocked and logged with its reason. The agent pauses automatically on any flagged charge, and only the customer can resume it. Refund requests mirror a card dispute process: Submitted, Under review, Merchant contacted, then Refunded or Declined, with a date for each step and an expected time to resolve.

**Alternatives considered:** Warning the customer and letting the charge continue would leave money at risk until they responded. Flagging a charge without pausing would let the agent keep spending while something is wrong. A simple refund button would give customers no visibility into progress.

**Consequences:** A harmless change, such as a lower final price, is also blocked, so false blocks need watching. One flagged charge stops all agent purchases until the customer acts. In the prototype, processing is mock, stages are advanced by hand, and resolution estimates are placeholders.

## 002: Approvals expire after 3 days, with countdown reminders

- **Date:** 2026-11-08
- **Status:** Accepted

**Context:** A pending approval had no time limit, so a purchase could wait forever and keep holding part of the budget.

**Decision:** A pending approval lasts 3 days. The customer receives an in-app reminder on day 1 and day 2, and each reminder counts down to expiry, for example "Reminder 1 of 2 - this request expires in 2 days". If there is no decision by day 3, the purchase is auto-denied and logged. This supersedes the part of decision 001 where the agent waits indefinitely.

**Why:** 3 days gives busy customers time to respond. Reminders with a countdown reduce missed approvals. Auto-deny is the safe default.

**Alternatives considered:** Waiting indefinitely leaves budget held with no end. Auto-approving at expiry would let money move without the customer's decision.

**Consequences:** A customer who misses all reminders loses that purchase and the agent moves on. Reminders are in-app only in the prototype, and testers use a simulated clock to see them.

## 001: Prototype behavior for open PRD questions

- **Date:** 2026-11-08
- **Status:** Proposed, partly superseded by 002 and 005

**Context:** The first prototype needed working behavior for questions the PRD leaves open.

**Decision:** The budget is one overall limit. A purchase waiting for approval holds its amount against the budget, and rules are checked again when it is approved. The agent waits indefinitely for a decision. Revoking access cancels waiting purchases and invalidates the test token. Approval happens on a mobile-friendly screen, with no push notification. The app is a dependency-free Node server that keeps data in memory for a single customer.

**Alternatives considered:** Per-purchase or per-period budgets, approval timeouts, and a database were left out to keep the prototype small until the PRD questions are settled.

**Consequences:** The prototype is quick to run and change, but data is lost on restart and there are no customer accounts. These choices should be revisited as the PRD questions are answered.
