import { NextResponse } from "next/server";
import { VENUES } from "@/lib/spots";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(VENUES, {
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
