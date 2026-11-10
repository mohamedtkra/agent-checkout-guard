# Test Scenarios: Revoking, Purchase History, and the Reviewed Plan

**Source:** PRD requirements R57 to R64.

**Total scenarios:** 14

**Coverage:** Happy path, edge cases, errors, and security. Performance is not covered, because the prototype uses mock data.

**Verified by:** "Unit" means `test/revoke-and-plan.test.js` or another automated test. "Browser" means the flow was run once in headless Chrome. The browser script is not part of this repository.

| # | Scenario | Type | Priority | Verified by |
| --- | --- | --- | --- | --- |
| 1 | Revoke with nothing in progress | Happy path | High | Unit (guard only, screen not run) |
| 2 | Revoke with purchases waiting, cleared, and on hold | Happy path | Critical | Unit, browser |
| 3 | Keep agent | Happy path | Critical | Browser |
| 4 | Revoke while the agent waits for a decision | Edge case | Critical | Unit, browser |
| 5 | Revoke while the agent is between purchases | Edge case | Critical | Unit |
| 6 | Approve a purchase that was just stopped | Error | High | Unit |
| 7 | Revoke an agent that is already revoked | Error | Medium | Unit |
| 8 | Revoke another customer's agent | Security | Critical | Unit |
| 9 | Revoke one of two agents | Edge case | High | Unit, browser |
| 10 | View a removed agent's history | Happy path | High | Unit, browser |
| 11 | Stay on Activity during an approval request | Edge case | High | Browser |
| 12 | Filter Activity by agent | Happy path | Medium | Browser |
| 13 | Plan shows who will be asked | Happy path | Medium | Unit, browser |
| 14 | Purchase off the reviewed plan | Security | Critical | Unit, browser |

## Key scenarios

### Scenario 2: Revoke with purchases waiting, cleared, and on hold

**Tests:** R57, R58, R59. **Preconditions:** A connected agent has one purchase of each kind. **Role:** Customer. **Priority:** Critical.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Choose Revoke | Confirmation lists all three purchases and the hold to be released. The agent is still Active |
| 2 | Choose Revoke access | A screen says the agent has been removed, and lists the three purchases as Canceled |
| 3 | Open Activity | All three show Canceled, and the hold is gone from Home |

**Postconditions:** The token no longer works, and nothing is on hold.

### Scenario 4: Revoke while the agent waits for a decision

**Tests:** R59. **Preconditions:** The agent is running and a purchase is waiting for approval. **Role:** Customer. **Priority:** Critical.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Revoke and confirm | The waiting purchase is canceled and the approval request disappears |
| 2 | Wait longer than one shopping step | No new purchase appears, and none is logged as Unknown agent |
| 3 | Open Home | The agent is no longer shopping |

**Postconditions:** The agent's run has ended.

### Scenario 14: Purchase off the reviewed plan

**Tests:** R63. **Preconditions:** A connected agent with an approval amount above the purchase price. **Role:** Customer. **Priority:** Critical.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Use Simulate planted instruction | An approval request appears for Gift cards, marked as not on the plan |
| 2 | Choose Deny | Nothing is charged, and the agent's run ends |

**Postconditions:** The attempt and its reason are in the log and the agent's history.

## Coverage matrix

| Requirement | Happy path | Edge cases | Error handling | Security |
| --- | --- | --- | --- | --- |
| R57 Confirmation before revoking | 2, 3 | 4 | | |
| R58 Removed screen | 1, 2 | | | |
| R59 All ongoing purchases stop | 2 | 4, 5, 9 | 6, 7 | 8 |
| R60 Agent purchase history | 10 | | | |
| R61 Filter by agent | 12 | | | |
| R62 Plan shows who will be asked | 13 | | | |
| R63 Off-plan purchases need approval | 14 | | | 14 |
| R64 Approvals open over the current screen | 11 | | | |

## Test data

Mock merchants, test card tokens, and two demo agents. Trust level Ask me every time produces waiting purchases, and a low approval amount produces a mix.
