import { useEffect, useState } from "react";

export type PlacePhoto = {
  url: string;
  width: number;
  height: number;
};

export type PlaceReview = {
  text?: { text: string };
  rating: number;
  relativePublishTimeDescription: string;
  authorAttribution?: { displayName: string; photoUri?: string };
};

export type PlaceDetails = {
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  editorialSummary?: { text: string };
  photos: PlacePhoto[];
  reviews: PlaceReview[];
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  websiteUri?: string;
  googleMapsUri?: string;
};

const cache = new Map<string, PlaceDetails>();

export function usePlaceDetails(placeId: string | null | undefined) {
  const [data, setData] = useState<PlaceDetails | null>(
    placeId ? cache.get(placeId) ?? null : null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!placeId) { setData(null); return; }

    const cached = cache.get(placeId);
    if (cached) { setData(cached); return; }

    let cancelled = false;
    setLoading(true);

    fetch(`/api/places?id=${encodeURIComponent(placeId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const details: PlaceDetails = {
          rating: d.rating,
          userRatingCount: d.userRatingCount,
          priceLevel: d.priceLevel,
          editorialSummary: d.editorialSummary,
          photos: d.photos ?? [],
          reviews: (d.reviews ?? []).slice(0, 3),
          currentOpeningHours: d.currentOpeningHours ?? d.regularOpeningHours,
          websiteUri: d.websiteUri,
          googleMapsUri: d.googleMapsUri,
        };
        cache.set(placeId, details);
        setData(details);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [placeId]);

  return { data, loading };
}
