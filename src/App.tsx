import { useState } from "react";
import { DEMO } from "./demo";
import { OptionChainPage } from "./pages/OptionChainPage";
import { StrategyPage } from "./pages/StrategyPage";

const PAGES = {
  chain: { label: "Chain", Component: OptionChainPage },
  strategy: { label: "Strategy", Component: StrategyPage },
} as const;

type PageKey = keyof typeof PAGES;

export function App() {
  const [page, setPage] = useState<PageKey>(() => (new URLSearchParams(location.search).get("page") === "strategy" ? "strategy" : "chain"));
  // The symbol is shared, so switching tabs keeps you on the same underlying.
  const [symbol, setSymbol] = useState(() => new URLSearchParams(location.search).get("symbol")?.toUpperCase() || "SPY");
  const { Component } = PAGES[page];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden>
              <svg viewBox="0 0 20 20">
                <path d="M3 15.5 8 9l3.5 3.5L17 5" />
              </svg>
            </span>
            Options Analytics
          </div>
          <nav className="tabs">
            {(Object.keys(PAGES) as PageKey[]).map((key) => (
              <button key={key} className={key === page ? "on" : ""} onClick={() => setPage(key)}>
                {PAGES[key].label}
              </button>
            ))}
          </nav>
          {DEMO && <span className="demo-badge">Demo mode · simulated data</span>}
        </div>
      </header>
      <main className="content">
        <Component symbol={symbol} onSymbol={setSymbol} />
      </main>
    </div>
  );
}
