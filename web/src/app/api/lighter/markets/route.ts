import { NextResponse } from "next/server";
import { classify, type LighterMarket } from "@/lib/lighter";

// Lighter's exchange on Robinhood Chain: coins' portfolios trade here, and its market ids are stored on-chain.
const LIGHTER_URL = process.env.LIGHTER_URL ?? "https://api.rh.lighter.xyz";

export const revalidate = 30;

export async function GET() {
  const res = await fetch(`${LIGHTER_URL}/api/v1/orderBookDetails?filter=perp`, { next: { revalidate: 30 } });
  if (!res.ok) return NextResponse.json({ error: "lighter unavailable" }, { status: 502 });
  const body = await res.json();

  const markets: LighterMarket[] = (body.order_book_details ?? [])
    .filter((d: { status: string }) => d.status === "active")
    .map(
      (d: {
        market_id: number;
        symbol: string;
        last_trade_price: number;
        min_initial_margin_fraction: number;
        daily_price_change?: number;
        daily_price_low?: number;
        daily_price_high?: number;
        daily_quote_token_volume?: number;
      }) => ({
        marketId: d.market_id,
        symbol: d.symbol,
        price: Number(d.last_trade_price),
        maxLeverage: d.min_initial_margin_fraction ? Math.floor(10_000 / d.min_initial_margin_fraction) : 1,
        kind: classify(d.symbol),
        change24h: Number(d.daily_price_change ?? 0),
        low24h: Number(d.daily_price_low ?? 0),
        high24h: Number(d.daily_price_high ?? 0),
        volume24h: Number(d.daily_quote_token_volume ?? 0),
      }),
    )
    .sort((a: LighterMarket, b: LighterMarket) => a.symbol.localeCompare(b.symbol));

  return NextResponse.json({ markets });
}
