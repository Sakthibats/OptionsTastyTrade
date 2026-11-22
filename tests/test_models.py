from datetime import date
from decimal import Decimal

from options_tastytrade import OptionChain, OptionContract


def test_option_chain_keeps_normalized_contracts() -> None:
    contract = OptionContract(
        symbol="AAPL  270116C00200000",
        underlying="AAPL",
        expiration=date(2027, 1, 16),
        strike=Decimal("200"),
        option_type="call",
    )

    chain = OptionChain(underlying="AAPL", contracts=(contract,))

    assert chain.contracts[0].strike == Decimal("200")
