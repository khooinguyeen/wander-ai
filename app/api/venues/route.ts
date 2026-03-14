import { NextResponse } from "next/server";
import { VENUES } from "@/lib/spots";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(VENUES);
}
