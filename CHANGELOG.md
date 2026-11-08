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

### Changed

- Replaced the assumed product description in the README and one-pager with the confirmed one.
- Updated the PRD and metrics to match the confirmed product definition.
- Purchases now clear the guard first and are charged only after a separate final checkout.
- A lower final price is now allowed and logged. Only higher final prices are blocked.
