import { NextResponse } from "next/server";

import { listIngestEvents } from "@/lib/server/ingest-events";

export const runtime = "nodejs";

export async function GET() {
  const events = await listIngestEvents();
  return NextResponse.json(events, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
