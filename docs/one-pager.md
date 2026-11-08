# One-Pager: Agent Checkout Guard

**Status:** Draft. Items marked TBD are not decided yet.

## Problem

AI agents are starting to act on people's behalf, and that can include buying things. When an agent can complete a checkout, a mistake or a manipulated instruction can cost real money.

TBD: evidence that this problem is real and frequent enough to solve.

## Idea

Put a guard between the agent and the final purchase. The guard checks each attempted purchase against rules set by a person, then allows it, blocks it, or asks the person to approve it.

## Target user

TBD: for example, people using a shopping agent, developers building agents, or merchants receiving agent traffic.

## Why now

TBD

## What success looks like

See [metrics](metrics.md).

## Open questions

- Who is the first user?
- Where does the guard run: in the agent, in the browser, at the payment step, or somewhere else?
- Which agents and checkout flows are supported first?
