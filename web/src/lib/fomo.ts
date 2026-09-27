import { isAddress, type Address } from "viem";

/**
 * Fomo (fomo.family) creator-fee targets.
 *
 * Fomo has no "sign in with Fomo", so nobody can prove they own a Fomo username the way an X login proves an X
 * handle. What Fomo does have is a wallet per user that accepts ETH on Robinhood Chain (it lands in their Fomo
 * balance as WETH). So a Fomo target carries its payout wallet inside the handle itself — "fomo:name@0xabc…" —
 * and the claim signer will only ever approve paying that exact wallet. The handle is immutable on the treasury,
 * so the wallet can never be swapped later. The username is a label the launcher typed; it is not verified.
 */

const USERNAME = /^[a-z0-9_]{1,32}$/;

export function fomoHandle(username: string, wallet: string): string | null {
  const name = username.trim().replace(/^@/, "").toLowerCase();
  const addr = wallet.trim().toLowerCase();
  if (!USERNAME.test(name) || !isAddress(addr)) return null;
  return `fomo:${name}@${addr}`;
}

/** The username and wallet out of a "fomo:name@0x…" handle, or null for anything else. */
export function parseFomoHandle(handle: string): { username: string; wallet: Address } | null {
  const m = /^fomo:([a-z0-9_]{1,32})@(0x[0-9a-f]{40})$/.exec(handle.toLowerCase());
  return m ? { username: m[1], wallet: m[2] as Address } : null;
}

export const fomoProfileUrl = (username: string) => `https://fomo.family/profile/${username}`;
