# Metrics

**Status:** Draft. Limit breaches has a target of 0. No other baselines or targets have been set, and no data has been collected.

## Candidate metrics

| Metric | Definition | Baseline | Target |
| --- | --- | --- | --- |
| Rule violations stopped | Share of test purchases that break the budget or merchant rules and are blocked | TBD | TBD |
| Approval enforcement | Share of test purchases above the approval amount that wait for the customer's decision | TBD | TBD |
| False blocks | Share of test purchases within the rules that are wrongly blocked or held | TBD | TBD |
| Added checkout time | Extra time the rule check adds to a purchase that needs no approval | TBD | TBD |
| Approval response time | Time between an approval request and the customer's answer on their phone | TBD | TBD |
| Live log completeness | Share of agent actions that appear in the live log | TBD | TBD |
| Live log delay | Time between an agent action and its appearance in the live log | TBD | TBD |
| Revocation enforcement | Number of purchases completed after access is revoked | TBD | TBD |
| Overreach attempts blocked | Share of out-of-bounds purchase attempts, simulated or real, that the guard blocks before any charge | TBD | TBD |
| Time to refund | Time from a refund request being submitted to it reaching Refunded | TBD | TBD |
| Refund rate | Share of charged purchases that end in a Refunded request | TBD | TBD |
| Limit breaches | Number of charges that take agent spending past the allocation, available credit, or an agent's share | TBD | 0 |

## Measurement plan

All measurements use mock merchants and test card tokens, with no real payments. Refund stages are advanced by hand in the prototype, so time to refund only becomes meaningful once real processing times exist.

TBD: define how each metric is collected, and where test scenarios come from.
