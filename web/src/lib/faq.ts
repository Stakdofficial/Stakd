/** Homepage FAQ. Kept apart from the page so copy edits never touch layout code. */
export const FAQ: [string, string][] = [
  [
    "Where does the margin come from?",
    "From trading fees. Every buy and sell pays the coin's fee (1–5%) in ETH through a Uniswap v4 hook. 60% is swapped to USDG and deposited into Lighter as the coin's trading margin, and 40% goes to the platform.",
  ],
  [
    "Do creators earn anything?",
    "Yes, on coins launched with Hook v3 or later. Every buy and sell pays 1% in ETH on top of the coin's fee. By default it goes to the launcher's wallet, but it can be pointed at any X, GitHub, Discord, Telegram or Fomo account instead.",
  ],
  [
    "How does someone collect a creator fee sent to their account?",
    "For X, GitHub, Discord and Telegram, they sign in on the Claim page with that account and pick a wallet. Until then the ETH waits in the coin's treasury, and nobody else can take it. For Fomo there's nothing to claim: the fee is paid straight into their Fomo wallet on Robinhood Chain.",
  ],
  [
    "Why did my sell cost more than the usual fee?",
    "On Hook v3 coins the fee reacts to the market: selling within 15 seconds of your own buy pays the 5% maximum, and fast-moving prices add up to 2%. Wait a moment for the normal fee.",
  ],
  [
    "Who places the trades?",
    "A keeper bot run by the operator. It opens each leg at equity × weight × leverage in the coin's own Lighter sub-account, rebalances when positions drift, and takes partial profits.",
  ],
  [
    "What stops the keeper from taking the ETH?",
    "The treasury contract. Margin can only be swapped to USDG and deposited into Lighter, fee shares can only go to the creator and the platform, and returned profit can only buy back and burn the coin. Positions on Lighter do rely on trusting the operator.",
  ],
  [
    "What happens if the portfolio loses?",
    "Every portfolio has a stop-loss. If it falls 35% below its high, the keeper closes every position and pauses the coin. At 2x that's roughly a 17% market drop, well before liquidation. What's left stays in the coin's account. Burns only come from profit above the previous high.",
  ],
  [
    "When does profit get burned?",
    "When the portfolio is 10% above its previous high, the keeper locks in half of that gain and withdraws 75% of it to buy back and burn the coin. The rest stays in the portfolio.",
  ],
  [
    "Do I need ETH to launch a coin?",
    "No. The whole 1B supply goes into a Uniswap v4 pool as single-sided liquidity starting at a ~$2.5k market cap (about 0.9 ETH), locked forever. Buyers' ETH fills the pool as they trade. You only pay gas.",
  ],
  [
    "Why can stock legs sit idle?",
    "Lighter's equity perps trade 24/5. Outside market hours the keeper waits and opens or rebalances those legs once trading resumes.",
  ],
];
