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

### Changed

- Replaced the assumed product description in the README and one-pager with the confirmed one.
- Updated the PRD and metrics to match the confirmed product definition.
- Purchases now clear the guard first and are charged only after a separate final checkout.
