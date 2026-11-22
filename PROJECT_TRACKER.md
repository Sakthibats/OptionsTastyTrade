# Project Tracker

This file is the canonical tracker for all feature requests and their delivery
notes. Add a feature before implementation and update the same entry as it
progresses. Do not create parallel feature trackers.

## Status legend

- `Planned` — scoped but not started
- `In progress` — being implemented
- `Blocked` — needs a decision or external dependency
- `Done` — implemented and verified

## Features

### F-001 — Repository foundation

- **Status:** Done
- **Scope:** Establish a secure, AI-friendly Python foundation for Tastytrade
  option-chain research.
- **Acceptance criteria:** Local credentials are Git-ignored; a committed
  configuration template exists; agent conventions protect `.env`; a clear
  package, test, and documentation structure exists.
- **Decisions:** API adapters are separated from analysis code. Brokerage
  interaction is read-only by default.
- **Verification:** Confirmed `.env` is ignored and the package skeleton
  imports without external dependencies. `pytest` and `ruff` run after the
  documented development dependencies are installed.

### F-002 — Tastytrade option-chain reader

- **Status:** Planned
- **Scope:** Authenticate using local configuration and retrieve, normalize,
  and persist a selected ticker's option chain.
- **Acceptance criteria:** Read-only API access, typed normalized models,
  fixture-based tests, and documented configuration.

### F-003 — Option-chain analytics

- **Status:** Planned
- **Scope:** Add analysis for expirations, strikes, liquidity, implied
  volatility, Greeks, and user-selected strategy filters.
- **Acceptance criteria:** Pure, tested analysis functions and reproducible
  output from saved fixtures.
