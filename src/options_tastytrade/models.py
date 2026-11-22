"""Provider-neutral domain models for option-chain analysis."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class OptionContract:
    """A normalized, single option contract quote."""

    symbol: str
    underlying: str
    expiration: date
    strike: Decimal
    option_type: str
    bid: Decimal | None = None
    ask: Decimal | None = None
    implied_volatility: Decimal | None = None


@dataclass(frozen=True, slots=True)
class OptionChain:
    """A collection of normalized contracts for one underlying ticker."""

    underlying: str
    contracts: tuple[OptionContract, ...]
