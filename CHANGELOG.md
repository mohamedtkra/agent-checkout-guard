# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it has releases.

## [Unreleased]

### Added

- Initial project structure: README, changelog, and draft docs (one-pager, PRD, decisions, metrics, retro).
- MIT license.
- First working prototype: rules screen, mock shopping agent with three mock merchants, approve/deny screen, live activity log, and revoke access.
- Pre-charge verification that re-checks the final amount, merchant, and item, and blocks mismatches and duplicate purchases.
- Simulate agent overreach, plus a simulated charge that bypasses the guard.
- Flagged charges shown in red in the activity log, with automatic agent pause and a customer alert.
- Report a problem on purchases, refund requests with a status timeline, a Refunds tab, and mock processing with Simulate next step.
- Decision 003, and trust and safety flows and metrics in the PRD and metrics docs.
- Approval expiry: pending approvals last 3 days, with in-app countdown reminders on day 1 and day 2, an auto-deny on day 3, and Simulate next day for testers.
- Original invented merchant brands with SVG logos on purchase cards, the approval screen, and the activity log.
- Product details on each purchase: original SVG illustration, name, description, price, and color and size where they apply.
- Decisions 002 and 004, and approval expiry, branding, and product requirements in the PRD.
- Merchant categories with a second invented merchant in each, and allow-by-category on the Rules screen.
- Agent companies, with merchants choosing which ones they accept on a mock Merchant settings screen. Purchases are blocked if the merchant does not accept the agent's company.
- Purchase details screen with the item picture, item details, and merchant information.
- Decision 006, and requirements for categories, agent companies, and purchase details in the PRD.
- Demo accounts: sign-in with an email and a one-time code shown on screen, and sessions that expire after 30 minutes.
- SQLite storage for users, sessions, agent connections, consents, tokens, the audit log, and purchase data, so it survives restarts.
- Three labeled demo agents with original icons, connected through a step-up code and a consent screen.
- AP2-style signed consent records, stored for each connection and verified on every purchase.
- Per-agent scoped test card tokens. The guard checks the token, the consent, and the rules on every purchase.
- Connected agents page with permissions, connection date, last activity, spend, Edit permissions, and Revoke.
- Decision 005, and a background section on the Agentic Commerce Protocol and AP2 in the PRD.
- Mock credit limit, balance, and available credit on the demo account.
- Agent allocation of available credit on the Rules screen, with an optional split per connected agent.
- Holds placed on every open purchase intent, released when an intent is denied, expires, or is revoked, and partly released when a charge comes in lower.
- Atomic limit checks, with tests that fire 10 intents at once.
- Home screen meter showing allocation, spent, on hold, and remaining, plus open holds with expiry dates.
- Decision 007, allocation and hold requirements in the PRD, and a limit breaches metric with a target of 0.
- Category icons on purchases, and Spending by category and Spending by agent views.
- A warning on the approval screen that approval doesn't reserve funds.
- Decision 008, and a metric for approved purchases declined at checkout.

### Changed

- Replaced the assumed product description in the README and one-pager with the confirmed one.
- Updated the PRD and metrics to match the confirmed product definition.
- Purchases now clear the guard first and are charged only after a separate final checkout.
- A lower final price is now allowed and logged. Only higher final prices are blocked.
- Access is now per agent. Revoke moved from the header to each agent, and each demo agent belongs to one agent company.
- A flagged charge now pauses all of a customer's agents.
- The banner on every screen now reads "Demo - no real accounts or payments".
- The project now depends on better-sqlite3.
- The Rules budget is now the agent allocation, with a default of $500.
- Agents are now named "ChatGPT (OpenAI)" and "Gemini (Google)", with simple initial badges instead of icons.
- Holds are now placed only when a purchase is executed. Intents, including those waiting for approval, reserve nothing, and limits are checked at checkout.
- The agent allocation can now be split by company.

### Removed

- Merchant allow-lists, allow-by-category, and merchant choice of agent companies, including the mock Merchant settings screen.
