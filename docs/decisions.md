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

## 009: The guard's capabilities are composable feature blocks

- **Date:** 2026-11-08
- **Status:** Accepted

**Context:** The guard's capabilities apply to more than one use case, and each new use case should not need its own build. Showing them to others also needed a page that runs without a server.

**Decision:** The guard's capabilities are composable feature blocks, so one engine can generate prototypes for many use cases. The blocks are step-up verification and consent, approval with expiry and reminders, credit allocation and checkout holds, split by agent, report and refund tracking, and overreach detection and auto-pause. The guard logic lives in a browser-safe shared engine in `engine/`, used by both the app and a static Prototype Workbench. Merchants, products, and agents are supplied as a catalog, so a scenario can bring its own. The full app runs with every block on.

**Alternatives considered:** A separate copy of the logic for the workbench would drift from the app. A hosted backend for the workbench would add accounts and running costs that a demo doesn't need.

**Consequences:** A change to the engine reaches the app and the workbench together. Blocks can depend on each other, as split by agent depends on credit allocation. The checks at final checkout for a changed price, merchant, or item, and for duplicates, are part of the core and are not a block. The workbench keeps its state in the browser, its step-up codes are simulated on the page, and its consent records are not signed.

## 008: Categories are informational only, and holds apply only to executed purchases

- **Date:** 2026-11-08
- **Status:** Accepted

**Context:** Allowing and refusing purchases by merchant or category added rules customers did not need. Holds on intents also tied up allocation for purchases that might never happen, for up to 3 days.

**Decision:** Categories are informational only. They appear on purchases and in a spending breakdown, and they never allow or block anything. There is no merchant allow-list, merchants are identified only by name and category, and merchants no longer choose which agent companies they accept. Holds apply only to executed purchases, not intents. An intent, including one waiting for approval, reserves nothing. When a purchase is executed, one atomic step checks that charged amounts, active holds, and this purchase fit within the agent allocation, available credit, and the agent's share if split, then places the hold. If it does not fit, the purchase is declined with the reason. The allocation can be split by company. This supersedes decision 006 and the intent-hold part of decision 007.

**Trade-off:** Approved intents can fail at checkout. A customer can approve a purchase and still see it declined if other purchases use up the limit first. The approval screen warns about this: "Approval doesn't reserve funds; this can still fail if your limit is used up first."

**Alternatives considered:** Keeping holds on intents guarantees that an approved purchase can complete, but it ties up allocation for purchases that may never execute and lets a few waiting approvals block everyday spending. Reserving only after approval would still tie up funds until the purchase executes.

**Consequences:** Allocation is only used by purchases that actually execute. Customers may be asked to approve a purchase that cannot complete. The safety blocks from decision 003, which cover a changed price, merchant, or item, a duplicate purchase, and a paused or revoked agent, still apply. The checks stay atomic only while one server process handles each customer, as decision 007 notes.

## 007: Cap agent spending with an allocation of available credit, and place holds on open intents

- **Date:** 2026-11-08
- **Status:** Accepted, intent holds superseded by 008

**Context:** Agents act independently and can open purchases at the same time. Checking only what has already been charged would let several intents each pass and together go over the customer's limit.

**Decision:** Agent spending is capped by an allocation of the customer's available credit, optionally split per connected agent. The allocation can never exceed available credit. An open intent places a hold for its amount immediately, mirroring card authorization holds. A new intent is accepted only if charged amounts, open holds, and the new amount fit within the allocation, available credit, and the agent's share. Holds are released when an intent is denied, expires, or is revoked, and the difference is released when a charge comes in lower. Limits are checked again at final charge, so concurrent intents can't exceed the limit.

**Alternatives considered:** Checking limits only at charge time would let approvals pile up against money that can't be spent. Keeping a separate budget beside the allocation would give customers two overlapping limits, so the Rules budget became the allocation.

**Consequences:** Holds reduce what agents can spend until they are released, so a stalled intent ties up allocation for up to 3 days. Once a split is set, an agent without a share can't spend. Checking limits and placing a hold is atomic because it is one uninterrupted step in the single server process that handles each customer. Running more than one server process would need the check moved into a database transaction.

## 006: Merchants choose agent companies, and customers can allow by category

- **Date:** 2026-11-08
- **Status:** Superseded by 008

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
