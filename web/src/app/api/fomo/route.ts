import { NextResponse } from "next/server";
import { createPublicClient, http, isAddress } from "viem";
import { chain } from "@/lib/config";

/**
 * Looks up a fomo.family username's wallet, so a launcher who only knows the username can point a creator fee at it.
 *
 * fomo.family keeps that lookup behind its own login, so this asks fomoapi.io — an unofficial directory that reads
 * fomo.family — with a server-side key. The free plan buys only ~100 lookups a month (2,500 credits each), so answers
 * are remembered. The wallet is then checked on Robinhood Chain: every Fomo wallet there runs the same delegated
 * code, which catches the directory handing back something that is not a Fomo wallet.
 */

const FOMO_WALLET_CODE = "0xef0100e6cae83bde06e4c305530e199d7217f42808555b";
const found = new Map<string, { wallet: string; onRobinhood: boolean }>();

export async function GET(req: Request) {
  const key = process.env.FOMO_API_KEY;
  if (!key) return NextResponse.json({ error: "Fomo lookup is not configured on this deployment." }, { status: 503 });

  const handle = (new URL(req.url).searchParams.get("handle") ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,32}$/.test(handle)) return NextResponse.json({ error: "That is not a Fomo username." }, { status: 400 });

  const cached = found.get(handle);
  if (cached) return NextResponse.json({ handle, ...cached });

  let data: { error?: string; wallets?: { evm?: string | null; status?: string } | null };
  try {
    const res = await fetch(`https://api.fomoapi.io/v2/users/${handle}`, {
      headers: { authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (res.status === 404) {
      return NextResponse.json(
        { error: `No Fomo user @${handle} found. Very new accounts can take a while to show up — paste their wallet instead.` },
        { status: 404 },
      );
    }
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    return NextResponse.json({ error: "The Fomo lookup is not answering. Paste their wallet instead." }, { status: 502 });
  }

  const evm = data.wallets?.evm;
  if (!evm) {
    // The directory resolves wallets on first request; the page asks again shortly.
    if (data.wallets?.status === "resolving") return NextResponse.json({ handle, resolving: true });
    return NextResponse.json({ error: `@${handle} has no wallet on record. Paste their wallet instead.` }, { status: 404 });
  }
  if (!isAddress(evm)) return NextResponse.json({ error: "The lookup returned a bad address." }, { status: 502 });

  const code = await createPublicClient({ chain, transport: http() })
    .getCode({ address: evm })
    .catch(() => undefined);
  const hit = { wallet: evm.toLowerCase(), onRobinhood: (code ?? "").toLowerCase() === FOMO_WALLET_CODE };
  found.set(handle, hit);
  return NextResponse.json({ handle, ...hit });
}
