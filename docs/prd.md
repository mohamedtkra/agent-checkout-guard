# PRD: Agent Checkout Guard

**Status:** Draft. Requirements below are candidates until the open questions are resolved.

## Summary

Agent Checkout Guard checks purchases attempted by an AI agent against rules set by a person before the purchase can complete.

## Goals

- Prevent purchases that a person has not allowed.
- Make every allow, block, and approval decision explainable.
- Keep legitimate purchases from being slowed down more than necessary.

## Non-goals

TBD

## Users

| User | Need |
| --- | --- |
| TBD | TBD |

## Candidate requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| R1 | A person can define purchase rules, such as spending limits and allowed merchants. | TBD |
| R2 | Each attempted purchase receives a result of allow, block, or needs approval. | TBD |
| R3 | A person can approve or reject a purchase that needs approval. | TBD |
| R4 | Each decision is recorded with the rule that caused it. | TBD |
| R5 | If the guard cannot reach a decision, the purchase does not proceed. | TBD |

## Key flow

1. The agent attempts a purchase.
2. The guard evaluates the purchase against the rules.
3. The guard allows it, blocks it, or requests approval.
4. The decision is recorded.

## Risks

- An agent could bypass the guard if the guard is not on the only path to payment.
- Too many approval requests could lead people to approve without reading them.
- Instructions planted in web pages could try to manipulate the agent into a purchase.

## Open questions

- Which integration point comes first?
- What purchase details can the guard reliably see?
- How are approvals delivered, and what happens if nobody responds?
