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
| R3 | A customer can set which merchants the agent may buy from. | TBD |
| R4 | A customer can set an amount above which a purchase requires their approval. | TBD |
| R5 | A purchase that breaks the budget or merchant rules is blocked. | TBD |
| R6 | A purchase above the approval amount does not complete until the customer approves it. | TBD |
| R7 | A customer can approve or reject a purchase from their phone. | TBD |
| R8 | A customer can see a live log of everything the agent did. | TBD |
| R9 | A customer can revoke the agent's access at any time, after which the agent cannot pay. | TBD |
| R10 | If the rules cannot be checked, the purchase does not proceed. | TBD |
| R11 | All purchases use mock merchants and test card tokens, with no real payments. | TBD |

## Key flow

1. The customer gives the agent permission to pay with a tokenized card and sets a budget, allowed merchants, and an approval amount.
2. The agent attempts a purchase from a mock merchant.
3. The purchase is checked against the customer's rules.
4. The purchase is blocked if it breaks a rule, held for phone approval if it is above the approval amount, and otherwise allowed.
5. Every agent action appears in the live log.
6. The customer can revoke access at any point.

## Risks

- An agent could bypass the rules if the tokenized card can be used without passing through them.
- Too many approval requests could lead customers to approve without reading them.
- Instructions planted in web pages could try to manipulate the agent into a purchase.

## Open questions

- Which AI shopping agents are supported first, and how do they connect?
- Does the budget apply per purchase, per period, or overall?
- How do approval requests reach the phone, and what happens if the customer does not respond?
- What happens to a purchase in progress when access is revoked?
