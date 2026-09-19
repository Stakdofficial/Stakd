export type LighterMarket = {
  marketId: number;
  symbol: string;
  price: number;
  maxLeverage: number;
  kind: "crypto" | "stock" | "other";
};

export type LighterPosition = {
  marketId: number;
  symbol: string;
  size: number; // signed
  value: number;
  unrealizedPnl: number;
  entryPrice: number;
};

export type LighterAccount = {
  index: number;
  equity: number;
  available: number;
  positions: LighterPosition[];
};

// Lighter lists equities, ETFs and indices alongside crypto; tag the common ones so the picker can group them.
const STOCKS = new Set(
  "SPY QQQ IWM US500 US100 AAPL MSFT NVDA TSLA AMZN GOOGL META AMD INTC AVGO TSM ASML ARM MU QCOM ORCL IBM DELL NOW PLTR HOOD COIN MSTR CRCL GME BABA MRVL SNDK WDC ADI CRWV NBIS RKLB GEV SOXL SOXS EWY BMNR".split(" "),
);
const CRYPTO_HINT = /^(BTC|ETH|SOL|XRP|DOGE|BNB|ADA|AVAX|LINK|DOT|LTC|BCH|TRX|SUI|APT|ARB|OP|NEAR|HYPE|TAO|AAVE|UNI|ENA|TON|1000.*)$/;

export function classify(symbol: string): LighterMarket["kind"] {
  if (STOCKS.has(symbol)) return "stock";
  if (CRYPTO_HINT.test(symbol)) return "crypto";
  return "other";
}

export function formatUsd(n: number, digits = 2) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}
