# Agent Checkout Guard

> **Status: early prototype.** It runs locally with mock data only.

Agent Checkout Guard is a customer-facing web app that lets a person give an AI shopping agent permission to pay with a tokenized card, within rules they set: a budget and approval required above a set amount. The customer approves purchases from their phone, sees a live log of everything the agent did, and can revoke access at any time.

**Target users:** busy consumers who want an agent to handle routine purchases without risking overspending or fraud.

**Demo only: no real accounts or payments.** It uses mock merchants and test card tokens, and it never asks for a real password or card number. The ChatGPT and Gemini agents are simulated. This project is not connected to or affiliated with OpenAI or Google.

## Try it online

**[Open the Prototype Workbench](https://mohamedtkra.github.io/agent-checkout-guard/workbench.html)**. Pick a scenario, switch feature blocks on or off, and tap through a live prototype in your browser. Nothing to install.

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
2. On **Agents**, connect a demo agent. Enter the step-up code, set its limits, and review the consent screen. This screen also shows your agent allocation, open holds, and spending by agent and category. Change the allocation or split it by company on **Rules**.
3. On **Shop**, choose the agent and send it shopping. It tries six purchases at mock merchants.
4. When a purchase needs your decision, the app opens **Approve**.
5. While a purchase waits for approval, use **Simulate next day** on **Shop** to see the reminders and the auto-deny on day 3.
6. Use **Simulate agent overreach** on **Shop** to watch the guard block an out-of-bounds purchase. Each tap tries a different one.
7. Use **Simulate charge that slips past the guard** to see a charge flagged in red, agents paused, and the customer alerted.
8. On **Activity**, use **Report a problem** on a purchase, then follow the request on **Refunds** with **Simulate next step**.
9. On a paid purchase, use **View purchase details** to see the item picture, its details, and the merchant's information.
10. On **Agents**, connect a second agent, then try **Edit permissions** or **Revoke**. Revoking one agent leaves the others working.
11. Use **Reset demo** on **Shop** to clear purchases and rules. Connected agents and the audit log are kept.

The guard logic lives in `engine/` and is shared by this app and the workbench (`workbench.html`, `workbench/`).

Data is stored in `data/`, which is not committed. To start over completely, stop the server and delete that folder. The server only accepts connections from this computer.
