# Red-Team: Agent Checkout Guard

**Plan in one line:** People will let an AI agent pay for routine purchases if they set the limits, approve from their phone, and can see and stop everything it does.

**Status:** Draft. No customer research has been done, so every threshold below is a proposal to confirm. Ranked by impact if wrong, likelihood of being wrong, and how cheap it is to test.

## Top kill-assumptions

### 1. Customers want to hand payment to an agent at all

- **Strongest case for it:** Routine purchases are tedious, and major payment networks are building for agent commerce.
- **Attack:** That is supplier activity. The PRD still has no evidence from customers, and the Why section is TBD.
- **Fails if:** People like having an agent find things, but still want to tap Pay themselves.
- **Evidence to get this week:** 5 conversations about the last three routine purchases each person made, and what annoyed them. No pitch.
- **Kill criterion:** Fewer than 2 of 5 describe a recent purchase they would have let something else complete.
- **Cheapest test:** Those 5 conversations, then show the plan screen and ask which items they would untick.

### 2. Customers read approvals rather than tapping through

- **Strongest case for it:** Approvals are specific, and show the item, the price, and why the agent chose it.
- **Attack:** New agents start at Ask me every time, so a six-item plan means one review and then six approvals. The safety model depends on attention that this flow uses up.
- **Fails if:** Customers approve quickly and without reading, so an approval stops being evidence of consent.
- **Evidence to get this week:** The approval rate on the planted gift-card request, with 5 testers who are not told it is there.
- **Kill criterion:** 2 or more of 5 approve it without comment.
- **Cheapest test:** A workbench session with a share link, using **Simulate planted instruction** partway through.

### 3. Amount limits are enough to keep an agent on task

- **Strongest case for it:** Limits cap the worst case, and are simple to explain.
- **Attack:** This one failed. A $25 gift-card purchase planted by a merchant page cleared a $50 approval amount without the customer seeing it.
- **Fails if:** The guard only looks at the amount, because an agent can then spend small sums on the wrong things.
- **Status:** Fixed in the prototype by [decision 011](decisions.md). Anything off the reviewed plan now needs approval.
- **What remains:** A planted instruction that changes choices within the plan is not detected, such as picking a costlier variant of a planned item at the planned price.
- **Cheapest test:** Include within-plan manipulation cases in the eval set once a real model is connected.

### 4. Customers can tell what their agent did

- **Strongest case for it:** Every action is in a live log, and each purchase has a trail.
- **Attack:** A complete log is not the same as an understandable one. Before this review, one agent's history could not be viewed by itself.
- **Fails if:** Customers cannot answer "what did this agent buy, and what is still in progress?" and so do not trust it enough to raise its limits.
- **Status:** Per-agent history and a confirmation listing ongoing purchases are now built. Comprehension is untested.
- **Evidence to get this week:** Ask 5 testers those two questions after a run, and time them.
- **Kill criterion:** 2 or more of 5 cannot answer within 30 seconds.
- **Cheapest test:** The same workbench session as assumption 2.

### 5. An approved purchase failing later is acceptable

- **Strongest case for it:** Reserving funds on approval would lock up credit for up to 3 days, for purchases that may never happen.
- **Attack:** To a customer, "I approved this" feels like a promise. The screen has a warning, but warnings are easy to skip.
- **Fails if:** A decline after approval reads as the product being broken.
- **Evidence to get this week:** Run a tester into a limit after an approval, and ask what they think happened.
- **Kill criterion:** 2 or more of 5 call it a bug or a broken promise.
- **Cheapest test:** A workbench scenario with a low allocation.

## What's well-reasoned

- **Limits checked at execution, in one step.** It prevents simultaneous purchases from exceeding a limit, and it holds up.
- **A separate token per agent, checked against a signed consent.** One agent can be removed without touching the others.
- **Starting agents at the most cautious trust level.** It is the right default until customers have reason to loosen it, even with the cost noted in assumption 2.
- **Rechecking the final amount, merchant, and item before any charge.** It closes the gap between what was approved and what is charged.

## What I couldn't assess

- How a real agent would connect, since the prototype's agent is scripted.
- Whether merchants would accept agents, or block them as bots.
- Who is liable when an agent makes a purchase the customer approved by mistake.
- Cost per transaction, which needs a real model.

## What to do next

Run one session with 5 testers on the workbench. It tests assumptions 2, 4, and 5 together, and the interviews for assumption 1 can use the same people.
