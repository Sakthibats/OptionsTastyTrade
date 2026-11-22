# OptionsTastyTrade agent guide

## Project purpose

Build a research-oriented Python application for retrieving and analysing
Tastytrade option chains. It must remain read-only with respect to brokerage
accounts unless a future feature explicitly changes that boundary.

## Secret handling — mandatory

- **Do not read, print, edit, search, stage, or commit `.env`.** Treat it as
  unavailable, even if the execution environment technically permits access.
- Read `.env.example` when configuration documentation is needed.
- New configuration keys must be added to `.env.example` with empty values and
  documented in `README.md`; never put a real token, password, account number,
  or private endpoint in tracked files.
- Do not run commands that glob `.env*`; target `.env.example` explicitly when
  necessary.

## Feature workflow

- `PROJECT_TRACKER.md` is the canonical feature tracker.
- Before implementation, add or update the feature's entry with scope and
  acceptance criteria. Keep its status current as work proceeds.
- Record material implementation decisions and verification in that entry when
  the feature is finished.
- Keep each feature focused, tested, and documented.

## Engineering conventions

- Keep API transport isolated from analysis logic so data providers can be
  swapped and analysis can be tested with fixtures.
- Use typed Python, small modules, and dependency injection at external
  boundaries.
- Preserve raw provider data separately from normalized domain models.
- Run `pytest` and `ruff check .` after relevant changes.
- Never add order placement, trading, or account mutation capabilities without
  explicit user approval and a dedicated safety review.
