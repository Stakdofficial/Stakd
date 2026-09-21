"use client";

/**
 * The two routes into a coin, side by side.
 *
 * The point people miss is that the fee is identical either way — what changes is where it goes. Showing both
 * columns with the same fee line at the top, and different destinations below, is what makes that land.
 */
export function SolanaRoutes() {
  return (
    <div className="routes">
      <div className="route route-here">
        <div className="route-top">
          <span className="route-chip">Robinhood Chain</span>
          <strong>Bought here</strong>
        </div>
        <div className="route-fee">the coin&apos;s fee, paid in ETH</div>
        <div className="route-dest dest-blue">
          <span className="route-emoji">📈</span>
          <div>
            <strong>Funds the leveraged portfolio</strong>
            <span>60% becomes margin on Lighter</span>
          </div>
        </div>
        <div className="route-dest dest-blue soft">
          <span className="route-emoji">💰</span>
          <div>
            <strong>Profit buys back &amp; burns</strong>
            <span>75% of realized profit</span>
          </div>
        </div>
      </div>

      <div className="route route-sol">
        <div className="route-top">
          <span className="route-chip chip-sol">Solana</span>
          <strong>Bought from Solana</strong>
        </div>
        <div className="route-fee">the same fee, paid in ETH</div>
        <div className="route-dest dest-orange">
          <span className="route-emoji">🔥</span>
          <div>
            <strong>Buys the coin back and burns it</strong>
            <span>60% of the fee, straight to burns</span>
          </div>
        </div>
        <div className="route-dest dest-orange soft">
          <span className="route-emoji">📉</span>
          <div>
            <strong>Supply goes down. Forever.</strong>
            <span>within a minute of the buy</span>
          </div>
        </div>
      </div>
    </div>
  );
}
