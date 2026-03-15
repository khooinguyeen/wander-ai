import type { Venue, VenueCategory, VenueRaw } from "@/lib/types";

export function normaliseCategory(raw: string): VenueCategory {
  const value = raw.toLowerCase();
  if (
    value.includes("restaurant") ||
    value.includes("bakery") ||
    value.includes("market") ||
    (value.includes("food") && !value.includes("shopping"))
  ) {
    return "restaurant";
  }
  if (value === "coffee") {
    return "cafe";
  }
  if (value === "bar") {
    return "bar";
  }
  if (
    value.includes("clothing") ||
    value.includes("shopping") ||
    value.includes("beauty") ||
    value.includes("home_goods")
  ) {
    return "shopping";
  }
  if (
    value.includes("attraction") ||
    value.includes("route") ||
    value.includes("natural_feature") ||
    value.includes("stadium") ||
    value.includes("lodging") ||
    value.includes("train_station") ||
    value.includes("entertainment")
  ) {
    return "attraction";
  }
  return "other";
}

export function hydrateVenues(raw: VenueRaw[]): Venue[] {
  const seen = new Map<string, Venue>();

  for (let index = 0; index < raw.length; index += 1) {
    const venueRaw = raw[index];
    const id = venueRaw.google_place_id ?? `venue_${index}`;
    const venue: Venue = {
      ...venueRaw,
      id,
      uiCategory: normaliseCategory(venueRaw.category),
    };
    const existing = seen.get(id);
    if (!existing || venueRaw.description.length > existing.description.length) {
      seen.set(id, venue);
    }
  }

  return Array.from(seen.values());
}
