import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { buildItinerary, parsePlanRequest } from "@/lib/plan";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsedRequest = parsePlanRequest(body);
    const itinerary = await buildItinerary(parsedRequest);

    return NextResponse.json(itinerary);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid request payload.",
          issues: error.issues
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to build itinerary."
      },
      { status: 500 }
    );
  }
}
