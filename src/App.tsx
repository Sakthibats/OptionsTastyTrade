import { useState } from "react";
import { DEMO } from "./demo";
import { OptionChainPage } from "./pages/OptionChainPage";
import { PositionsPage } from "./pages/PositionsPage";

const PAGES = {
  chain: { label: "Options", Component: OptionChainPage },
  positions: { label: "Positions", Component: PositionsPage },
} as const;

type PageKey = keyof typeof PAGES;

export function App() {
  const [page, setPage] = useState<PageKey>(() => (new URLSearchParams(location.search).get("page") === "positions" ? "positions" : "chain"));
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
        <Component />
      </main>
    </div>
  );
}
