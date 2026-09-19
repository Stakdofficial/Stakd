import type { Leg } from "@/lib/hooks";
import type { LighterMarket } from "@/lib/lighter";

export function legLabel(leg: Leg, markets?: Map<number, LighterMarket>) {
  return markets?.get(leg.marketId)?.symbol ?? `#${leg.marketId}`;
}

export function avgLeverage(legs: Leg[]) {
  return legs.reduce((sum, l) => sum + (l.weightBps / 10_000) * (l.leverageX10 / 10), 0);
}

export function Basket({ legs, markets }: { legs: Leg[]; markets?: Map<number, LighterMarket> }) {
  return (
    <div className="stack">
      <div className="weight-bar" aria-hidden>
        {legs.map((l) => (
          <div key={l.marketId} style={{ width: `${l.weightBps / 100}%` }} />
        ))}
      </div>
      <div className="legs">
        {legs.map((l) => (
          <span key={l.marketId} className={`chip ${l.isLong ? "chip-long" : "chip-short"}`}>
            {l.isLong ? "▲" : "▼"} {legLabel(l, markets)} {l.weightBps / 100}% · {l.leverageX10 / 10}x
          </span>
        ))}
      </div>
    </div>
  );
}
