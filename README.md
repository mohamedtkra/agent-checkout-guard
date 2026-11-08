# Agent Checkout Guard

> **Status: early prototype.** It runs locally with mock data only.

Agent Checkout Guard is a customer-facing web app that lets a person give an AI shopping agent permission to pay with a tokenized card, within rules they set: a budget, allowed merchants, and approval required above a set amount. The customer approves purchases from their phone, sees a live log of everything the agent did, and can revoke access at any time.

**Target users:** busy consumers who want an agent to handle routine purchases without risking overspending or fraud.

**Demo only: no real accounts or payments.** It uses mock merchants and test card tokens, and it never asks for a real password or card number.

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

You need Node.js 20 or later.

```sh
npm install
npm start
```

Then open http://localhost:4321. To use a different port, set `PORT`, for example `PORT=5000 npm start`.

To run the tests:

```sh
npm test
```

### Try it

1. Sign in with any made-up email and the code shown on screen.
2. On **Agents**, connect a demo agent. Enter the step-up code, set its limits, and review the consent screen.
3. On **Shop**, choose the agent and send it shopping. It tries six purchases at mock merchants.
4. When a purchase needs your decision, the app opens **Approve**.
5. While a purchase waits for approval, use **Simulate next day** on **Shop** to see the reminders and the auto-deny on day 3.
6. Use **Simulate agent overreach** on **Shop** to watch the guard block an out-of-bounds purchase. Each tap tries a different one.
7. Use **Simulate charge that slips past the guard** to see a charge flagged in red, agents paused, and the customer alerted.
8. On **Activity**, use **Report a problem** on a purchase, then follow the request on **Refunds** with **Simulate next step**.
9. On a paid purchase, use **View purchase details** to see the item picture, its details, and the merchant's information.
10. On **Agents**, connect a second agent, then try **Edit permissions** or **Revoke**. Revoking one agent leaves the others working.
11. On **Shop**, open **Merchant settings (mock)** to see merchants refuse agent companies they don't accept.
12. Use **Reset demo** on **Shop** to clear purchases and rules. Connected agents and the audit log are kept.

Data is stored in `data/`, which is not committed. To start over completely, stop the server and delete that folder. The server only accepts connections from this computer.
