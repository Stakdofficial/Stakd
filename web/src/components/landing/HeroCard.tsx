"use client";

/** How Stakd works, at a glance: a trade's ETH fee split into the portfolio and the platform (plus the creator's 1%
 *  on Hook v3 coins), then profit → burn. */
export function HeroCard() {
  return (
    <div className="hero-visual" aria-hidden>
      <div className="orbit orbit-1" />
      <div className="orbit orbit-2" />

      <div className="float-chip chip-a">
        <span className="dot green" /> Stocks &amp; crypto perps
      </div>
      <div className="float-chip chip-b">
        <span className="dot blue" /> Fees in ETH
      </div>
      <div className="float-chip chip-c">
        <span className="dot green" /> Liquidity locked
      </div>

      <div className="hero-card engine">
        <div className="spread">
          <strong style={{ fontSize: 16 }}>How every coin works</strong>
          <span className="chip chip-soft">Stakd engine</span>
        </div>

        <div className="engine-step">
          <div className="engine-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
          </div>
          <div>
            <div className="engine-title">Someone buys or sells the coin</div>
            <div className="muted small">Creator-set fee of 1–5%, always paid in ETH</div>
          </div>
        </div>

        <div className="engine-split">
          <div className="spread small">
            <span><b>60%</b> leverage portfolio</span>
            <span className="muted"><b>40%</b> platform</span>
          </div>
          <div className="split-bar">
            <div className="split-a" />
            <div className="split-b" />
          </div>
          <div className="small" style={{ marginTop: 8, color: "var(--gold)", fontWeight: 700 }}>+1% of every trade to the creator</div>
        </div>

        <div className="engine-step">
          <div className="engine-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 6-6" /></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div className="engine-title">Portfolio trades on Lighter</div>
            <div className="engine-legs">
              <span className="chip chip-long">Long</span>
              <span className="chip chip-short">Short</span>
              <span className="chip chip-soft">Up to 6 markets</span>
              <span className="chip chip-soft">1–10x</span>
            </div>
          </div>
        </div>

        <div className="engine-step last">
          <div className="engine-icon burn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5.5.5 1.5 1.5 2.5 2.5 2.5 0-2.5-1-4.5 0-7z" /></svg>
          </div>
          <div>
            <div className="engine-title">75% of profit buys back &amp; burns</div>
            <div className="muted small">Supply only goes down</div>
          </div>
        </div>
      </div>
    </div>
  );
}
