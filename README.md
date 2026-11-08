# Agent Checkout Guard

> **Status: early prototype.** It runs locally with mock data only.

Agent Checkout Guard is a customer-facing web app that lets a person give an AI shopping agent permission to pay with a tokenized card, within rules they set: a budget, allowed merchants, and approval required above a set amount. The customer approves purchases from their phone, sees a live log of everything the agent did, and can revoke access at any time.

**Target users:** busy consumers who want an agent to handle routine purchases without risking overspending or fraud.

**Mock merchants and test card tokens only, no real payments.**

## Documentation

| Document | Purpose |
| --- | --- |
| [One-pager](docs/one-pager.md) | The problem, the idea, and why it matters |
| [PRD](docs/prd.md) | Users, requirements, and scope |
| [Decisions](docs/decisions.md) | Log of significant decisions and their reasoning |
| [Metrics](docs/metrics.md) | How success will be measured |
| [Retro](docs/retro.md) | What worked, what did not, and what to change |
| [Changelog](CHANGELOG.md) | Notable changes to the project |

## Getting started

You need Node.js 20 or later. There are no packages to install.

```sh
npm start
```

Then open http://localhost:4321. To use a different port, set `PORT`, for example `PORT=5000 npm start`.

To run the tests:

```sh
npm test
```

### Try it

1. On **Rules**, save the rules to give the agent access.
2. On **Agent**, send the agent shopping. It tries six purchases at three mock merchants.
3. When a purchase needs your decision, the app opens **Approve**.
4. Watch **Activity**, or use **Revoke access** at any point.
5. On **Agent**, use **Simulate agent overreach** to watch the guard block an out-of-bounds purchase. Each tap tries a different one.
6. Use **Simulate charge that slips past the guard** to see a charge flagged in red, the agent paused, and the customer alerted.
7. On **Activity**, use **Report a problem** on a purchase, then follow the request on **Refunds** with **Simulate next step**.
8. Use **Reset demo** on **Agent** to start again.

Data is kept in memory, so restarting the server clears it. The server only accepts connections from this computer.
