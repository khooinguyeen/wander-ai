import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/**
 * Lightweight endpoint: returns a single thumbnail photo URL for a Place ID.
 * Much cheaper than the full details endpoint — only fetches the photos field.
 */
export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get("id");
  if (!placeId) {
    return NextResponse.json({ url: null }, { status: 400 });
  }
  if (!API_KEY) {
    return NextResponse.json({ url: null });
  }

  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "photos",
      },
    }
  );

  if (!res.ok) {
    return NextResponse.json({ url: null });
  }

  const data = await res.json();
  const photo = data.photos?.[0];

  if (!photo?.name) {
    return NextResponse.json({ url: null });
  }

  const url = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=400&key=${API_KEY}`;

  return NextResponse.json(
    { url },
    { headers: { "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000" } }
  );
}
