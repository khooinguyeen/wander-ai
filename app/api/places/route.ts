import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

const FIELDS = [
  "displayName",
  "rating",
  "userRatingCount",
  "currentOpeningHours",
  "priceLevel",
  "editorialSummary",
  "photos",
  "reviews",
  "websiteUri",
  "googleMapsUri",
  "regularOpeningHours",
].join(",");

/** Proxy for Google Places API (New) — fetches place details by Place ID */
export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get("id");
  if (!placeId) {
    return NextResponse.json({ error: "Missing id param" }, { status: 400 });
  }
  if (!API_KEY) {
    return NextResponse.json({ error: "No API key configured" }, { status: 500 });
  }

  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": FIELDS,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: "Places API error", status: res.status, detail: text },
      { status: res.status }
    );
  }

  const data = await res.json();

  // Resolve photo URIs — the new API returns photo resource names, not URLs
  if (data.photos) {
    data.photos = data.photos.slice(0, 5).map((p: { name: string; widthPx: number; heightPx: number; authorAttributions?: unknown[] }) => ({
      url: `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=600&key=${API_KEY}`,
      width: p.widthPx,
      height: p.heightPx,
      attributions: p.authorAttributions ?? [],
    }));
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" },
  });
}
