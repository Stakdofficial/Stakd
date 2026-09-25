import { NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/server-auth";
import { createWalletClient, http, isAddress, keccak256, encodeAbiParameters, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain } from "@/lib/config";

/**
 * Signs the proof a coin's treasury needs before it will pay a creator fee to someone's wallet.
 *
 * The treasury only knows a handle like "x:someone". It cannot check a social login itself, so it trusts a
 * signature from the platform's claim signer. This route is the only thing that produces one: it verifies the
 * caller really is logged in as that account with Privy, then signs exactly one claim — this chain, this
 * treasury, that account's immutable id, the wallet they named, and an expiry.
 */

const CLAIM_TTL_SECONDS = 15 * 60;

/** Privy calls them "twitter"/"github"/"discord"; coins are launched with our own shorter prefixes. */
const PLATFORMS: Record<string, string> = { x: "twitter_oauth", github: "github_oauth", discord: "discord_oauth" };

type LinkedAccount = { type: string; subject?: string; username?: string };

export async function POST(req: Request) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const signerKey = process.env.CLAIM_SIGNER_PRIVATE_KEY;
  if (!appId || !appSecret || !signerKey) {
    return NextResponse.json({ error: "Claiming is not configured on this deployment." }, { status: 503 });
  }

  let body: { accessToken?: string; treasury?: string; handle?: string; payout?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const { accessToken, treasury, handle, payout } = body;
  if (!accessToken || !treasury || !handle || !payout) {
    return NextResponse.json({ error: "Missing accessToken, treasury, handle or payout." }, { status: 400 });
  }
  if (!isAddress(treasury) || !isAddress(payout)) {
    return NextResponse.json({ error: "treasury and payout must be addresses." }, { status: 400 });
  }

  // "x:someone" — the platform decides which linked account we are allowed to look at.
  const sep = handle.indexOf(":");
  const platform = handle.slice(0, sep).toLowerCase();
  const username = handle.slice(sep + 1).toLowerCase();
  const privyType = PLATFORMS[platform];
  if (sep < 0 || !privyType || !username) {
    return NextResponse.json({ error: "Handle must look like x:name, github:name or discord:name." }, { status: 400 });
  }

  const privy = new PrivyClient(appId, appSecret);
  let user;
  try {
    const claims = await privy.verifyAuthToken(accessToken);
    user = await privy.getUser(claims.userId);
  } catch {
    return NextResponse.json({ error: "That login could not be verified. Sign in again." }, { status: 401 });
  }

  // They must be logged in with the same platform, as the same username the coin was launched for.
  const account = (user.linkedAccounts as LinkedAccount[]).find(
    (a) => a.type === privyType && (a.username ?? "").toLowerCase() === username,
  );
  if (!account?.subject) {
    return NextResponse.json(
      { error: `You are not signed in as ${handle}. Log in with that account to claim it.` },
      { status: 403 },
    );
  }

  // The platform's own id for the account, not the username: usernames get renamed and recycled, ids do not.
  const subject = keccak256(new TextEncoder().encode(`${platform}:${account.subject}`));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + CLAIM_TTL_SECONDS);

  const digest = keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "string" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [BigInt(chain.id), treasury as Address, handle, subject, payout as Address, deadline],
    ),
  );
  const signer = privateKeyToAccount(signerKey as `0x${string}`);
  const proof = await createWalletClient({ account: signer, chain, transport: http() }).signMessage({
    account: signer,
    message: { raw: digest },
  });

  return NextResponse.json({ subject, payout, deadline: deadline.toString(), proof });
}
