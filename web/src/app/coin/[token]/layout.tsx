import type { Metadata } from "next";
import { isAddress, type Address } from "viem";
import { getCoinSummary } from "@/lib/coinSummary";

// Per-coin title and description for link previews; the share card image comes from opengraph-image.tsx.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const coin = isAddress(token) ? await getCoinSummary(token as Address).catch(() => null) : null;
  if (!coin) return {};
  const title = `${coin.name} ($${coin.symbol})`;
  const description = `A coin with its own leveraged portfolio: ${coin.legs.map((l) => `${l.isLong ? "long" : "short"} ${l.symbol}`).join(", ")}. Trade on Stakd.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", site: "@StakdOfficial", title, description } };
}

export default function CoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
