import { NextResponse } from "next/server";

import { ingestTikTokUrl, tiktokIngestRequestSchema } from "@/lib/server/tiktok-ingest";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { url } = tiktokIngestRequestSchema.parse(payload);
    const source = typeof payload?.source === "string" ? payload.source : "unknown";
    const result = await ingestTikTokUrl(url, source);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown TikTok ingest error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
