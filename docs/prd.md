# PRD: Agent Checkout Guard

**Status:** Draft. The product definition is confirmed. Requirement priorities and items marked TBD are not decided yet.

## Summary

Agent Checkout Guard is a customer-facing web app that lets a person give an AI shopping agent permission to pay with a tokenized card, within rules they set: a budget and approval required above a set amount. The customer approves purchases from their phone, sees a live log of everything the agent did, and can revoke access at any time.

The product uses mock merchants and test card tokens only, with no real payments.

## Background

Agent Checkout Guard borrows ideas from two emerging agent payment protocols. It does not implement or interoperate with either one. See [decision 005](decisions.md).

- **[Agentic Commerce Protocol](https://developers.openai.com/commerce/specs/payment) (ACP):** [Co-developed by OpenAI and Stripe](https://stripe.com/newsroom/news/stripe-openai-instant-checkout). Its Delegated Payment Spec limits a payment token by a maximum amount and an expiry, so an agent never holds an unrestricted card. The per-agent scoped test tokens here follow that idea.
- **[Agent Payments Protocol](https://ap2-protocol.org/) (AP2):** Announced by Google in September 2025. It uses signed mandates as proof of what a person authorized: an Intent Mandate for the boundaries an agent may act within, a Cart Mandate for a specific cart, and a Payment Mandate for the payment network. The signed consent record here is modeled on an Intent Mandate. The prototype has no Cart or Payment Mandates, and it signs on the server rather than with a key held by the customer.

## Goals

- Let an agent handle routine purchases without the customer overspending or being exposed to fraud.
- Keep the customer in control through their rules, phone approvals, and the ability to revoke access.
- Show the customer everything the agent did.

## Non-goals

- Processing real payments.
- Integrating with real merchants.
- Processing real refunds or card disputes.

Other non-goals: TBD

## Users

| User | Need |
| --- | --- |
| Busy consumers | An agent that handles routine purchases without risking overspending or fraud |

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| R1 | A customer can give an AI shopping agent permission to pay with a tokenized card. | TBD |
| R2 | A customer can set a budget for the agent. | TBD |
| R3 | Merchants are identified only by name and category. There is no merchant allow-list. | TBD |
| R4 | A customer can set an amount above which a purchase requires their approval. | TBD |
| R5 | A purchase is declined only when it breaks a rule (overall budget, approval amount, consent scope, or expiry) or would go over the agent allocation or available credit. The safety checks in R12 and R13 still apply. | TBD |
| R6 | A purchase above the approval amount does not complete until the customer approves it. | TBD |
| R7 | A customer can approve or reject a purchase from their phone. | TBD |
| R8 | A customer can see a live log of everything the agent did. | TBD |
| R9 | A customer can revoke the agent's access at any time, after which the agent cannot pay. | TBD |
| R10 | If the rules cannot be checked, the purchase does not proceed. | TBD |
| R11 | All purchases use mock merchants and test card tokens, with no real payments. | TBD |
| R12 | Before any charge, the server re-checks the final amount, merchant, and item against the rules and against what the customer approved. | TBD |
| R13 | A higher final price, a different merchant or item, or a duplicate purchase is blocked, and each block is logged with its reason. A lower final price is allowed and logged. | TBD |
| R14 | Testers can simulate an agent attempting an out-of-bounds purchase and see the guard catch it. | TBD |
| R15 | A charge that goes through outside the rules is flagged in red in the activity log, pauses the agent automatically, and alerts the customer. | TBD |
| R16 | Every purchase in the activity log has a way to report a problem, with a reason and an optional note. | TBD |
| R17 | A report creates a refund request with a status timeline showing Submitted, Under review, Merchant contacted, and Refunded or Declined, with the date of each step and the expected time to resolve. | TBD |
| R18 | A Refunds tab lists all refund requests. | TBD |
| R19 | Refund processing is mocked, and testers can move a request to its next stage. | TBD |
| R20 | A pending approval lasts 3 days. | TBD |
| R21 | The customer receives an in-app reminder on day 1 and day 2, each showing the reminder count and the time left before the request expires. | TBD |
| R22 | With no decision by day 3, the purchase is auto-denied and logged. | TBD |
| R23 | Testers can simulate the next day to see reminders and expiry without waiting. | TBD |
| R24 | Each mock merchant has an original, invented brand name and a simple SVG logo, shown on purchase cards, the approval screen, and the activity log. | TBD |
| R25 | Each purchase shows an original product illustration or placeholder, name, short description, price, and color and size where they apply. The approval screen shows all of this. | TBD |
| R26 | Categories are labels only. Each purchase shows its category icon, and a Spending by category view breaks down spending. There are no category rules or limits. | TBD |
| R27 | A Spending by agent view shows each agent's allocation, spent, on hold, and remaining. | TBD |
| R28 | After a purchase is made, the customer can see a picture of the item, its details, and the merchant's information. | TBD |
| R29 | A customer signs in to a demo account with an email and a one-time 6-digit code shown on screen, with no real email or SMS. Sessions expire after 30 minutes. | TBD |
| R30 | Users, sessions, agent connections, consents, tokens, and the audit log are stored in SQLite and survive restarts. | TBD |
| R31 | A customer can connect simulated agents named "ChatGPT (OpenAI)" and "Gemini (Google)", shown with a simple badge of the initial and a distinct color rather than official logos. Connecting requires a step-up check with a second one-time code. Sign-in and consent screens stay the bank's own and never imitate OpenAI's or Google's login pages. | TBD |
| R32 | Before linking, a consent screen shows exactly what the agent may do (budget, approval amount, approval expiry, and connection expiry date) with Allow and Cancel. An AP2-style signed consent record is stored. | TBD |
| R33 | Each connected agent gets its own test card token, valid only within its consent. The guard checks the token, the consent, and the rules on every purchase. | TBD |
| R34 | A Connected agents page lists each agent with its permissions, connection date, last activity, and spend so far, with Edit permissions and Revoke. Revoking one agent does not affect the others. | TBD |
| R35 | A "Demo - no real accounts or payments" banner appears on every screen, and the product never asks for real passwords or card numbers. | TBD |
| R36 | The demo account has a mock credit limit, current balance, and available credit. | TBD |
| R37 | On the Rules screen, the customer sets how much of their available credit agents may use in total, and can optionally split it by company. The allocation can never exceed available credit. | TBD |
| R38 | An intent, including one waiting for approval, reserves nothing. A hold is placed only when a purchase is executed. | TBD |
| R39 | At execution, a purchase goes through only if charged amounts, active holds, and this purchase fit within the agent allocation, available credit, and the agent's share if split. Otherwise it is declined with the reason. | TBD |
| R40 | A hold becomes a charge when the purchase settles, and is released if it expires or the agent is revoked or paused first. | TBD |
| R41 | The execution check is atomic, so simultaneous purchases cannot exceed a limit. | TBD |
| R42 | The home screen shows a meter of allocation, spent, on hold, and remaining, plus a list of open holds with their expiry dates. | TBD |
| R43 | The approval screen warns: "Approval doesn't reserve funds; this can still fail if your limit is used up first." | TBD |

## Key flow

1. The customer gives the agent permission to pay with a tokenized card and sets a budget and an approval amount.
2. The agent attempts a purchase from a mock merchant.
3. The purchase is checked against the customer's rules.
4. The purchase is blocked if it breaks a rule, held for phone approval if it is above the approval amount, and otherwise allowed.
5. Every agent action appears in the live log.
6. The customer can revoke access at any point.

## Connect an agent flow

See [decision 005](decisions.md).

1. The customer signs in with a demo email and a one-time code shown on screen.
2. The customer chooses a demo agent and confirms it is them with a second one-time code.
3. The customer sets the agent's limits, which cannot go beyond their Rules.
4. A consent screen shows exactly what the agent may do, with Allow and Cancel.
5. On Allow, a signed consent record is stored and the agent receives its own test card token.
6. Each purchase is checked against the token, the signed consent, and the rules.
7. The customer can edit permissions, which needs another step-up and signs a new consent, or revoke that agent alone.

## Credit allocation and holds flow

See decisions [007 and 008](decisions.md).

1. The customer sets an agent allocation from their available credit, for example $500 of $3,800, and can split it by company, for example ChatGPT $300 and Gemini $200.
2. An agent opens a purchase intent. It reserves nothing, even while waiting for approval.
3. When the purchase is executed, the guard checks charged amounts, active holds, and this purchase against every limit in one step.
4. If it fits, a hold is placed. If not, it is declined with the reason, for example "Declined at checkout: your $500 agent limit has $40 left."
5. When the purchase settles, the hold becomes spend. If it expires or the agent is revoked or paused first, the hold is released.

**Trade-off:** an approved intent can fail at checkout if other purchases use up the limit first.

## Approval expiry flow

See [decision 002](decisions.md).

1. A purchase above the approval amount waits for the customer for up to 3 days.
2. On day 1, the customer sees "Reminder 1 of 2 - this request expires in 2 days".
3. On day 2, the customer sees "Reminder 2 of 2 - this request expires in 1 day".
4. With no decision by day 3, the purchase is auto-denied and logged, its budget hold is released, and the agent moves on.

## Trust and safety flows

See decisions [003 and 004](decisions.md).

### Prevent

1. A purchase that passes the rules, or that the customer approves, is cleared for checkout. No money moves yet.
2. The agent submits the final amount, merchant, and item.
3. The server compares them with what was cleared or approved, and checks the rules again.
4. A higher price, a different merchant or item, or a duplicate purchase is blocked.
5. A lower price is allowed, charged at the lower amount, and logged.
6. Each block appears in the activity log with its reason.

### Detect

1. A tester uses **Simulate agent overreach**, and the agent attempts an out-of-bounds purchase.
2. The guard blocks it and logs the reason.
3. If a charge ever goes through outside the rules, it is flagged in red in the activity log.
4. The agent pauses automatically, purchases in progress are canceled, and the customer is alerted.
5. The agent stays paused until the customer resumes it.

### Report and refund

1. The customer chooses **Report a problem** on a purchase in the activity log.
2. The customer picks a reason (charged more than approved, didn't authorize, wrong item, never arrived, or other) and can add a note.
3. A refund request is created with its own tracking screen and appears in the **Refunds** tab.
4. The request moves through Submitted, Under review, Merchant contacted, and then Refunded or Declined. Testers advance it with **Simulate next step**.
5. A refunded amount returns to the budget. A report on a purchase that was never charged resolves as Declined, because there is nothing to refund.

## Risks

- An agent could bypass the rules if the tokenized card can be used without passing through them.
- Too many approval requests could lead customers to approve without reading them.
- Instructions planted in web pages could try to manipulate the agent into a purchase.

## Open questions

- Which AI shopping agents are supported first, and how do they connect?
- Does the budget apply per purchase, per period, or overall?
- How do approval requests and reminders reach the phone outside the app?
- What happens to a purchase in progress when access is revoked?
