import { NextResponse } from "next/server";
import type { LighterAccount } from "@/lib/lighter";

// Lighter's exchange on Robinhood Chain: coins' portfolios trade here, and its market ids are stored on-chain.
const LIGHTER_URL = process.env.LIGHTER_URL ?? "https://api.rh.lighter.xyz";

type RawPosition = {
  market_id: number;
  symbol: string;
  sign: number;
  position: string;
  position_value: string;
  unrealized_pnl: string;
  avg_entry_price: string;
  liquidation_price: string;
  total_funding_paid_out: string;
};

export async function GET(_req: Request, { params }: { params: Promise<{ index: string }> }) {
  const { index } = await params;
  if (!/^\d+$/.test(index)) return NextResponse.json({ error: "bad index" }, { status: 400 });

  const res = await fetch(`${LIGHTER_URL}/api/v1/account?by=index&value=${index}`, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: "lighter unavailable" }, { status: 502 });
  const acct = (await res.json()).accounts?.[0];
  if (!acct) return NextResponse.json({ error: "not found" }, { status: 404 });

  const account: LighterAccount = {
    index: Number(index),
    equity: Number(acct.total_asset_value),
    available: Number(acct.available_balance),
    owner: acct.l1_address,
    initialMargin: Number(acct.cross_initial_margin_requirement),
    maintenanceMargin: Number(acct.cross_maintenance_margin_requirement),
    positions: (acct.positions as RawPosition[])
      .filter((p) => Number(p.position) !== 0)
      .map((p) => ({
        marketId: p.market_id,
        symbol: p.symbol,
        size: Number(p.position) * (p.sign < 0 ? -1 : 1),
        value: Number(p.position_value),
        unrealizedPnl: Number(p.unrealized_pnl),
        entryPrice: Number(p.avg_entry_price),
        liquidationPrice: Number(p.liquidation_price),
        fundingPaid: Number(p.total_funding_paid_out),
      })),
  };
  return NextResponse.json(account);
}
