import { NextResponse } from "next/server";
import { SERVER_RPC_URLS } from "@/lib/config";

/**
 * Same-origin JSON-RPC proxy for the browser.
 *
 * The public Robinhood RPC is fronted by several edges, and some of them answer with the CORS header twice
 * ("Access-Control-Allow-Origin: *, *"), which every browser rejects — the page then reads nothing from the chain and
 * shows "0 launched". Calls from our own origin have no CORS to get wrong, so the browser talks to this route and the
 * server does the upstream call. It also keeps a private RPC key (RPC_URL) out of the bundle.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 15_000;

async function callUpstream(url: string, body: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 1_000_000) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let lastError = "no upstream configured";
  // Try each upstream in turn: a flaky edge or a rate-limited key falls through to the next one.
  for (const url of SERVER_RPC_URLS) {
    try {
      const upstream = await callUpstream(url, body);
      if (!upstream.ok) {
        lastError = `${url.split("/")[2]} responded ${upstream.status}`;
        continue;
      }
      const text = await upstream.text();
      return new NextResponse(text, {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return NextResponse.json({ error: `rpc unavailable: ${lastError}` }, { status: 502 });
}
