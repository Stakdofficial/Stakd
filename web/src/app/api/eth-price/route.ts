import { NextResponse } from "next/server";

export const revalidate = 60;

export async function GET() {
  const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { next: { revalidate: 60 } });
  if (!res.ok) return NextResponse.json({ error: "price unavailable" }, { status: 502 });
  const body = await res.json();
  return NextResponse.json({ usd: Number(body.data.amount) });
}
