# OptionsTastyTrade

A safe, research-first foundation for analysing listed option chains using the
Tastytrade API. The initial codebase deliberately contains no trade placement
or account mutation capability.

## Quick start

1. Create a local virtual environment: `python3 -m venv .venv`
2. Activate it and install development dependencies: `python3 -m pip install -e ".[dev]"`
3. Copy `.env.example` to `.env` and populate only your local copy.
4. Run checks: `python3 -m pytest` and `ruff check .`

## Credentials

`.env` is ignored by Git and must never be committed. `.env.example` is the
committed contract for required configuration. `AGENTS.md` directs coding
agents to treat `.env` as unavailable and use only the example file.

Tastytrade authentication has not yet been implemented; F-002 in
[`PROJECT_TRACKER.md`](PROJECT_TRACKER.md) will define the supported flow before
any live API calls are added.

## Layout

```text
src/options_tastytrade/  Application package
tests/                   Automated tests
PROJECT_TRACKER.md       Canonical feature tracker
AGENTS.md                Instructions for coding agents
.env.example             Committed configuration contract
```

## Working agreement

Every feature request starts as an entry in `PROJECT_TRACKER.md`, with scope
and acceptance criteria, and is updated with decisions and verification when
complete.
