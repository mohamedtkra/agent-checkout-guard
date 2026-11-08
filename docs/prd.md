# PRD: Agent Checkout Guard

**Status:** Draft. The product definition is confirmed. Requirement priorities and items marked TBD are not decided yet.

## Summary

Agent Checkout Guard is a customer-facing web app that lets a person give an AI shopping agent permission to pay with a tokenized card, within rules they set: a budget, allowed merchants, and approval required above a set amount. The customer approves purchases from their phone, sees a live log of everything the agent did, and can revoke access at any time.

The product uses mock merchants and test card tokens only, with no real payments.

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
| Merchants (mock in the prototype) | Control over which agent companies can buy from them |

## Requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| R1 | A customer can give an AI shopping agent permission to pay with a tokenized card. | TBD |
| R2 | A customer can set a budget for the agent. | TBD |
| R3 | A customer can set which merchants the agent may buy from. | TBD |
| R4 | A customer can set an amount above which a purchase requires their approval. | TBD |
| R5 | A purchase that breaks the budget or merchant rules is blocked. | TBD |
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
| R26 | Merchants belong to categories, and a customer can allow a whole category or individual merchants. | TBD |
| R27 | Each merchant chooses which agent companies it accepts, and a purchase is blocked if the merchant does not accept the agent's company. | TBD |
| R28 | After a purchase is made, the customer can see a picture of the item, its details, and the merchant's information. | TBD |

## Key flow

1. The customer gives the agent permission to pay with a tokenized card and sets a budget, allowed merchants, and an approval amount.
2. The agent attempts a purchase from a mock merchant.
3. The purchase is checked against the customer's rules.
4. The purchase is blocked if it breaks a rule, held for phone approval if it is above the approval amount, and otherwise allowed.
5. Every agent action appears in the live log.
6. The customer can revoke access at any point.

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
