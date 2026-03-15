import { NextResponse } from "next/server";
import { getVenues } from "@/lib/spots";

export const runtime = "nodejs";

export async function GET() {
  const venues = await getVenues();
  return NextResponse.json(venues, {
    headers: {
      "Cache-Control": "no-cache",
    },
  });
}
