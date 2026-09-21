import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { chain } from "@/lib/config";

// Top holders and holder count from GoPlus's token-security API. It indexes Robinhood Chain,
// needs no key, and caching here keeps page views from each hitting their rate limit.
export const revalidate = 300;

type GoPlusHolder = { address: string; percent: string; is_contract: number; is_locked: number };

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAddress(token)) return NextResponse.json({ error: "bad address" }, { status: 400 });

  const res = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chain.id}?contract_addresses=${token}`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) return NextResponse.json({ error: "holders unavailable" }, { status: 502 });
  const body = await res.json();
  const r = body?.result?.[token.toLowerCase()];

  return NextResponse.json({
    count: Number(r?.holder_count ?? 0),
    holders: ((r?.holders ?? []) as GoPlusHolder[]).map((h) => ({
      address: h.address,
      percent: Number(h.percent),
      isContract: h.is_contract === 1,
      isLocked: h.is_locked === 1,
    })),
  });
}
